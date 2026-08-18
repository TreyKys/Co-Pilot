import { StagehandEngine, LinkedInProfileData } from './engines/stagehand-engine';
import { ReDroidEngine } from './engines/redroid-engine';
import { logger } from '../logger';

export type JobMode = 'auto' | 'fast' | 'stealth';

export interface DispatcherResult {
  success: boolean;
  data?: LinkedInProfileData | any;
  engineUsed: 'stagehand' | 'redroid';
  error?: string;
}

export class DualEngineDispatcher {
  private stagehandEngine: StagehandEngine;
  private redroidEngine: ReDroidEngine;

  constructor() {
    this.stagehandEngine = new StagehandEngine();
    this.redroidEngine = new ReDroidEngine();
  }

  public async dispatch(jobId: string, url: string, mode: JobMode = 'auto', cookieValue?: string): Promise<DispatcherResult> {
    logger.info({ event: 'dispatching_job', jobId, mode, url });

    if (mode === 'fast' || mode === 'auto') {
      logger.info({ event: 'invoking_stagehand', jobId });
      const shResult = await this.stagehandEngine.extractProfile(url, cookieValue || '');

      if (shResult.data && !shResult.challengeDetected) {
        return { success: true, data: shResult.data, engineUsed: 'stagehand' };
      }

      if (mode === 'fast') {
         // Fail immediately if strict fast mode is requested and we hit a challenge or error
         return { success: false, engineUsed: 'stagehand', error: shResult.error || 'Stagehand extraction failed' };
      }

      // If auto, and we hit a challenge, failover to stealth
      if (mode === 'auto' && shResult.challengeDetected) {
         logger.warn({ event: 'failover_to_stealth', jobId, reason: 'Challenge detected in fast mode' });
         return this.dispatchStealth(jobId, url);
      }

      // Auto but failed for a non-challenge reason, still failover to stealth just in case
      logger.warn({ event: 'failover_to_stealth_unknown_error', jobId, reason: shResult.error });
      return this.dispatchStealth(jobId, url);
    }

    if (mode === 'stealth') {
      return this.dispatchStealth(jobId, url);
    }

    return { success: false, engineUsed: 'stagehand', error: 'Invalid mode' };
  }

  private async dispatchStealth(jobId: string, url: string): Promise<DispatcherResult> {
    logger.info({ event: 'invoking_redroid', jobId });
    const rdResult = await this.redroidEngine.extractProfile(jobId, url);

    if (rdResult.rawTextDump) {
      return { success: true, data: { rawTextDump: rdResult.rawTextDump }, engineUsed: 'redroid' };
    }

    return { success: false, engineUsed: 'redroid', error: rdResult.error || 'ReDroid extraction failed' };
  }
}
