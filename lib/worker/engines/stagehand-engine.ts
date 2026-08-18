import { z } from 'zod';
import { logger } from '../../logger';

export interface LinkedInProfileData {
  fullName: string;
  headline: string;
  location: string;
  summary?: string;
  experienceSummary?: string;
  rawTextDump?: string;
}

export const ProfileDataSchema = z.object({
  fullName: z.string(),
  headline: z.string(),
  location: z.string(),
  summary: z.string().optional(),
  experienceSummary: z.string().optional(),
  rawTextDump: z.string().optional(),
});

export class StagehandEngine {
  public async extractProfile(targetUrl: string, cookieValue: string): Promise<{ data: LinkedInProfileData | null, challengeDetected: boolean, error?: string }> {
    let stagehand: any = null;
    try {
      logger.info({ event: 'stagehand_init_started' });

      // Dynamically import Stagehand to bypass CJS static import block for ESM-only packages
      const { Stagehand } = await import('@browserbasehq/stagehand');

      // Create and initialize the Stagehand instance
      stagehand = await Stagehand.create({
        env: 'LOCAL',
        modelName: 'gpt-4o-mini',
      } as any);

      logger.info({ event: 'stagehand_init_success' });

      const page: any = stagehand.page;
      const context = page.context();

      // Inject the authentication cookie dynamically from RAM
      logger.debug({ event: 'injecting_cookie' });
      await context.addCookies([
        {
          name: 'li_at',
          value: cookieValue,
          domain: '.linkedin.com',
          path: '/',
          httpOnly: true,
          secure: true,
        },
      ]);

      logger.info({ event: 'navigating_to_target', url: targetUrl });

      await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

      // Check for captchas or challenge redirects
      const pageUrl = page.url();
      const content = await page.content();

      if (pageUrl.includes('checkpoint') || pageUrl.includes('challenge') || content.includes('security check') || content.includes('captcha')) {
        logger.warn({ event: 'stagehand_challenge_detected', url: pageUrl });
        return { data: null, challengeDetected: true, error: 'CHALLENGE_DETECTED' };
      }

      logger.info({ event: 'starting_extraction' });
      const extractionResult = await page.extract({
        instruction: "Extract the person's full name, headline, location, a brief summary of their about section, and highlights of their experience. Combine experience into a summary string.",
        schema: ProfileDataSchema
      });

      logger.info({ event: 'extraction_success' });

      // Cast as LinkedInProfileData
      return { data: extractionResult as unknown as LinkedInProfileData, challengeDetected: false };

    } catch (error: any) {
      logger.error({ event: 'stagehand_extraction_failed', error: String(error) });
      const isChallenge = error?.message?.toLowerCase().includes('checkpoint') || error?.message?.toLowerCase().includes('challenge');
      return { data: null, challengeDetected: isChallenge, error: error?.message || 'UNKNOWN_ERROR' };
    } finally {
      if (stagehand) {
        logger.info({ event: 'stagehand_closing_browser' });
        await stagehand.close();
      }
    }
  }
}
