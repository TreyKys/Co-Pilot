import Docker from 'dockerode';
import { AdbBridge } from '../adbBridge';
import { logger } from '../../logger';

export class ReDroidEngine {
  private docker: Docker;

  constructor() {
    this.docker = new Docker();
  }

  public async extractProfile(jobId: string, targetUrl: string): Promise<{ rawTextDump: string | null, error?: string }> {
    let container: Docker.Container | null = null;
    let adbBridge: AdbBridge | null = null;

    try {
      logger.info({ event: 'redroid_spawning_container', jobId });
      const { container: newContainer, hostPort } = await this.spawnContainer(jobId);
      container = newContainer;

      const hostIp = '127.0.0.1';
      adbBridge = new AdbBridge(hostIp, hostPort);

      const connected = await adbBridge.connect(15, 3000);
      if (!connected) {
        throw new Error('Failed to establish ADB connection to ReDroid container');
      }

      logger.info({ event: 'redroid_mobile_execution_started', jobId });

      // In a real implementation this would navigate to the URL or open the app and dump UI XML
      // For the mock phase, we just prove execution works
      const androidVersion = await adbBridge.executeShellCommand('getprop ro.build.version.release');
      logger.info({ event: 'redroid_execution_test', version: androidVersion });

      // Simulate mobile UI dump
      const rawTextDump = `Simulated mobile UI dump for ${targetUrl} via Android ${androidVersion}`;

      logger.info({ event: 'redroid_mobile_execution_completed', jobId });

      return { rawTextDump };

    } catch (error: any) {
      logger.error({ event: 'redroid_processing_error', jobId, error: String(error) });
      return { rawTextDump: null, error: error?.message || 'UNKNOWN_ERROR' };
    } finally {
      if (adbBridge) {
        await adbBridge.disconnect();
      }

      if (container) {
        await this.teardownContainer(container);
      }
    }
  }

  private async spawnContainer(jobId: string): Promise<{ container: Docker.Container, hostPort: string }> {
    const container = await this.docker.createContainer({
      Image: 'redroid/redroid:11.0.0-latest',
      name: `redroid-worker-${jobId.substring(0, 8)}`,
      HostConfig: {
        Privileged: true,
        PortBindings: {
          '5555/tcp': [
            { HostPort: '' }
          ]
        }
      }
    });

    await container.start();

    const data = await container.inspect();
    const ports = data.NetworkSettings.Ports['5555/tcp'];

    if (!ports || ports.length === 0) {
      throw new Error('Failed to find bound host port for container ADB');
    }

    const hostPort = ports[0].HostPort;
    logger.info({ event: 'redroid_container_spawned', containerId: container.id, hostPort });

    return { container, hostPort };
  }

  private async teardownContainer(container: Docker.Container) {
    try {
      logger.info({ event: 'redroid_teardown_container', containerId: container.id });
      await container.stop({ t: 1 });
    } catch (error: any) {
      if (error.statusCode !== 304) {
        logger.warn({ event: 'redroid_container_stop_error', error: String(error) });
      }
    }

    try {
      await container.remove({ force: true, v: true });
    } catch (error) {
      logger.error({ event: 'redroid_container_remove_error', error: String(error) });
    }
  }
}
