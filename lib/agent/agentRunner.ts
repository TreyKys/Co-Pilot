import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import { logger } from '../logger';

export const ProfileDataSchema = z.object({
  fullName: z.string(),
  headline: z.string(),
  location: z.string(),
  aboutSummary: z.string().optional(),
  experienceHighlights: z.array(z.string()).optional(),
});

export type ProfileData = z.infer<typeof ProfileDataSchema>;

export async function executeProfileExtraction(
  cookieValue: string,
  targetUrl: string
): Promise<ProfileData | null> {
  let stagehand: Stagehand | null = null;
  try {
    logger.info({ event: 'stagehand_init_started' });

    // Create and initialize the Stagehand instance
    stagehand = await Stagehand.create({
      env: 'LOCAL',
      modelName: 'gpt-4o-mini',
      // We don't set apiKey here because it will automatically pick up process.env.OPENAI_API_KEY
    } as any);

    logger.info({ event: 'stagehand_init_success' });

    // The page property is available directly on the Stagehand instance, but its typings might be hidden.
    // We access it directly and cast to any to avoid TypeScript errors while using the underlying Playwright API.
    const page: any = (stagehand as any).page;
    const context = page.context();

    // Inject the authentication cookie
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

    // Navigate to the target profile
    logger.info({ event: 'navigating_to_target', url: targetUrl });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // Extract structured data using Stagehand's AI-driven extraction
    logger.info({ event: 'starting_extraction' });
    const extractionResult = await stagehand.extract(
      "Extract the person's full name, headline, location, a brief summary of their about section, and highlights of their experience.",
      ProfileDataSchema
    );

    logger.info({ event: 'extraction_success' });

    // We have to extract the actual matched data, as Stagehand returns metadata alongside it
    return extractionResult.data;

  } catch (error) {
    logger.error({ event: 'extraction_failed', error: String(error) });
    return null;
  } finally {
    if (stagehand) {
      logger.info({ event: 'closing_browser' });
      await stagehand.close();
    }
  }
}
