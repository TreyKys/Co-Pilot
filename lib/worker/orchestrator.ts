import Docker from 'dockerode';
import { createServerSupabaseClient } from '../supabase/server';
import { AdbBridge } from './adbBridge';
import { logger } from '../logger';

export class WorkerOrchestrator {
  private docker: Docker;
  private isPolling = false;
  private pollIntervalMs = 5000;

  constructor() {
    this.docker = new Docker(); // Standard local Docker socket
  }

  /**
   * Starts the continuous background polling loop.
   */
  async start() {
    if (this.isPolling) return;
    this.isPolling = true;
    logger.info({ event: 'orchestrator_started', pollIntervalMs: this.pollIntervalMs });

    while (this.isPolling) {
      try {
        await this.processNextJob();
      } catch (error) {
        logger.error({ event: 'orchestrator_poll_error', error: String(error) });
      }

      // Wait before the next poll asynchronously
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  /**
   * Stops the continuous polling loop.
   */
  stop() {
    this.isPolling = false;
    logger.info({ event: 'orchestrator_stopped' });
  }

  /**
   * Queries Supabase for the oldest pending job, locks it, and processes it.
   */
  public async processNextJob(): Promise<void> {
    const supabase = createServerSupabaseClient();

    // Fetch oldest pending job
    const { data: jobs, error: fetchError } = await supabase
      .from('job_queue')
      .select('*')
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true })
      .limit(1);

    if (fetchError) {
      throw new Error(`Failed to fetch from queue: ${fetchError.message}`);
    }

    if (!jobs || jobs.length === 0) {
      return; // Queue is empty
    }

    const job = jobs[0];
    logger.info({ event: 'job_found', jobId: job.id, action: job.action_type });

    // Try to lock it by updating status to processing
    // NOTE: In a highly concurrent multi-worker setup, this needs an RPC using SELECT FOR UPDATE
    // but for this phase, a simple update with status match check prevents basic collisions.
    const { data: updatedJobs, error: updateError } = await supabase
      .from('job_queue')
      .update({ status: 'processing' })
      .eq('id', job.id)
      .eq('status', 'pending') // Optimistic locking
      .select('id');

    // Make sure we actually locked it! If another worker grabbed it, updatedJobs might be empty.
    if (updateError || !updatedJobs || updatedJobs.length === 0) {
      logger.warn({ event: 'job_lock_failed_or_stolen', jobId: job.id });
      return;
    }

    logger.info({ event: 'job_locked', jobId: job.id });

    // Process the job sequentially, blocking the next iteration of the start loop
    await this.processJob(job);
  }

  /**
   * Orchestrates the container lifecycle and mobile execution.
   */
  private async processJob(job: any) {
    let container: Docker.Container | null = null;
    let adbBridge: AdbBridge | null = null;
    let jobStatus: 'completed' | 'failed' = 'failed';
    const supabase = createServerSupabaseClient();

    try {
      // 1. Spawn Container
      logger.info({ event: 'spawning_container', jobId: job.id });
      const { container: newContainer, hostPort } = await this.spawnContainer(job.id);
      container = newContainer;

      // 2. Connect ADB
      // Assuming Docker is running locally; IP is 127.0.0.1.
      // If running inside a container, host.docker.internal or a bridge IP might be needed.
      const hostIp = '127.0.0.1';
      adbBridge = new AdbBridge(hostIp, hostPort);

      // Connect using asynchronous sleep in the retry block
      const connected = await adbBridge.connect(15, 3000); // 45 seconds total wait time for boot
      if (!connected) {
        throw new Error('Failed to establish ADB connection to ReDroid container');
      }

      // 3. Mobile Execution
      logger.info({ event: 'mobile_execution_started', jobId: job.id });

      // Execute the test shell command to prove the bridge works
      const androidVersion = await adbBridge.executeShellCommand('getprop ro.build.version.release');
      logger.info({ event: 'mobile_execution_test_command', result: androidVersion, command: 'getprop ro.build.version.release' });

      logger.info({ event: 'mobile_execution_completed', jobId: job.id });

      jobStatus = 'completed';

    } catch (error) {
      logger.error({ event: 'job_processing_error', jobId: job.id, error: String(error) });
      jobStatus = 'failed';
    } finally {
      // 4. Teardown & Update Status

      if (adbBridge) {
        await adbBridge.disconnect();
      }

      if (container) {
        await this.teardownContainer(container);
      }

      logger.info({ event: 'updating_job_status', jobId: job.id, status: jobStatus });
      await supabase
        .from('job_queue')
        .update({ status: jobStatus, completed_at: new Date().toISOString() })
        .eq('id', job.id);
    }
  }

  /**
   * Spawns a new ReDroid container and returns the container instance and dynamically assigned host port.
   */
  private async spawnContainer(jobId: string): Promise<{ container: Docker.Container, hostPort: string }> {
    // Note: ensure 'redroid/redroid:11.0.0-latest' is pulled locally.
    const container = await this.docker.createContainer({
      Image: 'redroid/redroid:11.0.0-latest',
      name: `redroid-worker-${jobId.substring(0, 8)}`,
      HostConfig: {
        Privileged: true, // ReDroid requires privileged mode to run Android's init system
        PortBindings: {
          '5555/tcp': [
            { HostPort: '' } // Leave blank for Docker to assign an ephemeral port
          ]
        }
      }
    });

    await container.start();

    // Inspect to find the dynamically assigned port
    const data = await container.inspect();
    const ports = data.NetworkSettings.Ports['5555/tcp'];

    if (!ports || ports.length === 0) {
      throw new Error('Failed to find bound host port for container ADB');
    }

    const hostPort = ports[0].HostPort;
    logger.info({ event: 'container_spawned', containerId: container.id, hostPort });

    return { container, hostPort };
  }

  /**
   * Forcefully stops and removes a container.
   */
  private async teardownContainer(container: Docker.Container) {
    try {
      logger.info({ event: 'teardown_container', containerId: container.id });
      await container.stop({ t: 1 }); // 1 second timeout before SIGKILL
    } catch (error: any) {
      // Ignore "container already stopped" (304) errors
      if (error.statusCode !== 304) {
        logger.warn({ event: 'container_stop_error', error: String(error) });
      }
    }

    try {
      await container.remove({ force: true, v: true });
    } catch (error) {
      logger.error({ event: 'container_remove_error', error: String(error) });
    }
  }
}
