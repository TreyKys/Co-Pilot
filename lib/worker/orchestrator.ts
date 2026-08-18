import { createServerSupabaseClient } from '../supabase/server';
import { DualEngineDispatcher } from './dispatcher';
import { logger } from '../logger';

export class WorkerOrchestrator {
  private isPolling = false;
  private pollIntervalMs = 5000;
  private dispatcher: DualEngineDispatcher;

  private MAX_CONCURRENT_JOBS = 5;
  private activeJobsCount = 0;

  constructor() {
    this.dispatcher = new DualEngineDispatcher();
  }

  /**
   * Starts the continuous background polling loop.
   */
  async start() {
    if (this.isPolling) return;
    this.isPolling = true;
    logger.info({ event: 'orchestrator_started', pollIntervalMs: this.pollIntervalMs, maxConcurrent: this.MAX_CONCURRENT_JOBS });

    while (this.isPolling) {
      try {
        if (this.activeJobsCount < this.MAX_CONCURRENT_JOBS) {
          await this.processNextJob();
        } else {
          logger.debug({ event: 'max_concurrency_reached', count: this.activeJobsCount });
        }
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

    // Fetch oldest pending job.
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
    const { data: updatedJobs, error: updateError } = await supabase
      .from('job_queue')
      .update({ status: 'processing' })
      .eq('id', job.id)
      .eq('status', 'pending') // Optimistic locking
      .select('id');

    if (updateError || !updatedJobs || updatedJobs.length === 0) {
      logger.warn({ event: 'job_lock_failed_or_stolen', jobId: job.id });
      return;
    }

    logger.info({ event: 'job_locked', jobId: job.id });

    // We do NOT await processJob here so we can process concurrently up to MAX_CONCURRENT_JOBS.
    this.activeJobsCount++;
    this.processJob(job).catch(err => {
      logger.error({ event: 'unhandled_job_error', jobId: job.id, error: String(err) });
    });
  }

  /**
   * Orchestrates the execution via the DualEngineDispatcher and updates DB status.
   */
  private async processJob(job: any) {
    const supabase = createServerSupabaseClient();

    let mode: 'auto' | 'fast' | 'stealth' = 'auto';
    let url = '';
    let callbackUrl = '';
    let tgChatId: number | null = null;

    try {
        if (job.payload && typeof job.payload === 'object') {
           if (job.payload.mode) mode = job.payload.mode;
           if (job.payload.url) url = job.payload.url;
           if (job.payload.callbackUrl) callbackUrl = job.payload.callbackUrl;
           if (job.payload.tgChatId) tgChatId = job.payload.tgChatId;
        } else if (job.payload && typeof job.payload === 'string') {
           const parsed = JSON.parse(job.payload);
           if (parsed.mode) mode = parsed.mode;
           if (parsed.url) url = parsed.url;
           if (parsed.callbackUrl) callbackUrl = parsed.callbackUrl;
           if (parsed.tgChatId) tgChatId = parsed.tgChatId;
        }
    } catch(e) {
       // fallback defaults
    }

    if (!url) {
       logger.error({ event: 'job_missing_url', jobId: job.id });
       await supabase.from('job_queue').update({ status: 'failed', completed_at: new Date().toISOString() }).eq('id', job.id);
       this.activeJobsCount--;
       return;
    }

    try {
      const cookieValue = process.env.LINKEDIN_LI_AT_COOKIE || '';

      const result = await this.dispatcher.dispatch(job.id, url, mode, cookieValue);

      logger.info({ event: 'job_execution_finished', jobId: job.id, success: result.success, engine: result.engineUsed });

      const finalStatus = result.success ? 'completed' : 'failed';
      const resultPayload = result.data || { error: result.error };

      // Update the job with the result and status
      await supabase
        .from('job_queue')
        .update({
          status: finalStatus,
          result_payload: resultPayload,
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);

      // Webhook outbound delivery
      if (callbackUrl) {
         fetch(callbackUrl, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ jobId: job.id, status: finalStatus, result: resultPayload })
         }).catch(e => logger.error({ event: 'webhook_delivery_error', url: callbackUrl, error: e.message }));
      }

      // Telegram Real-time Feedback
      if (tgChatId && process.env.TELEGRAM_BOT_TOKEN) {
         let messageText = `Job ${job.id} failed: ${result.error || 'Unknown error'}`;
         if (result.success && result.data) {
             const d = result.data;
             if (result.engineUsed === 'stagehand') {
                 messageText = `✅ Extraction Complete!\n\nName: ${d.fullName}\nHeadline: ${d.headline}\nLocation: ${d.location}\nSummary: ${d.summary?.substring(0,100)}...`;
             } else {
                 messageText = `✅ Mobile Stealth Extraction Complete!\n\nDump: ${d.rawTextDump?.substring(0, 150)}...`;
             }
         }

         fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ chat_id: tgChatId, text: messageText })
         }).catch(e => logger.error({ event: 'tg_completion_notify_error', error: e.message }));
      }

    } catch (error) {
      logger.error({ event: 'job_processing_error', jobId: job.id, error: String(error) });
      await supabase
        .from('job_queue')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', job.id);
    } finally {
      this.activeJobsCount--;
    }
  }
}
