import { config } from 'dotenv';
import { executeProfileExtraction } from '../lib/agent/agentRunner';
import { logger } from '../lib/logger';

config();

async function run() {
  const apiKey = process.env.OPENAI_API_KEY;
  const liCookie = process.env.LINKEDIN_LI_AT_COOKIE;

  if (!apiKey || !liCookie) {
    logger.warn({
      event: 'test_skip',
      message: '[SKIP] Missing environment credentials (OPENAI_API_KEY or LINKEDIN_LI_AT_COOKIE) for live extraction. Engine initialized cleanly.'
    });
    process.exit(0);
  }

  const targetUrl = 'https://www.linkedin.com/in/williamhgates/';

  logger.info({ event: 'test_start', target: targetUrl });

  const result = await executeProfileExtraction(liCookie, targetUrl);

  if (result) {
    logger.info({ event: 'test_success', result });
  } else {
    logger.error({ event: 'test_failure', error: 'Extraction returned null' });
  }
}

run().catch(error => {
  console.error('Unhandled error during test:', error);
  process.exit(1);
});
