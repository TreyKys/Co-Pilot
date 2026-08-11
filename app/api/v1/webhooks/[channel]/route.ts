import { NextRequest, NextResponse } from 'next/server';
import { TelegramAdapter } from '@/lib/channels/telegram';
import { logger } from '@/lib/logger';
import { BaseChannelAdapter } from '@/types/gateway';
import { getOrCreateUserByChannel } from '@/lib/services/userService';
import { enqueueJob } from '@/lib/services/queueService';

export async function POST(
  req: NextRequest,
  { params }: { params: { channel: string } }
) {
  const { channel } = params;

  logger.info({ channel, event: 'webhook_received' });

  let adapter: BaseChannelAdapter;

  switch (channel.toLowerCase()) {
    case 'telegram':
      adapter = new TelegramAdapter();
      break;
    default:
      logger.warn({ channel, event: 'unsupported_channel' });
      return NextResponse.json(
        { error: `Unsupported channel: ${channel}` },
        { status: 400 }
      );
  }

  const isValid = await adapter.validateSecret(req);
  if (!isValid) {
    logger.warn({ channel, event: 'auth_failed' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedMessage = await adapter.parsePayload(req);

  if (parsedMessage) {
    logger.info({
      channel,
      event: 'message_normalized',
      message: parsedMessage,
    });

    // Phase 2: Connect the pipe
    const providerChatId = parsedMessage.metadata?.chatId;
    if (!providerChatId) {
      logger.error({ channel, event: 'missing_chat_id_in_metadata' });
      return NextResponse.json({ error: 'Internal error: missing chat ID' }, { status: 500 });
    }

    // 1. Resolve Identity
    const userResult = await getOrCreateUserByChannel(channel.toLowerCase(), providerChatId);
    if (!userResult) {
      logger.error({ channel, event: 'user_resolution_failed' });
      return NextResponse.json({ error: 'Failed to resolve user' }, { status: 500 });
    }

    // 2. Enqueue Job
    const queueResult = await enqueueJob(parsedMessage, userResult.userId, userResult.userChannelId);

    if (!queueResult.success) {
      logger.warn({ channel, event: 'queue_job_failed', error: queueResult.error });
      if (queueResult.error === 'Insufficient credits') {
         return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 });
      }
      return NextResponse.json({ error: 'Failed to enqueue job' }, { status: 500 });
    }

    logger.info({ channel, event: 'job_queued', jobId: queueResult.jobId });

    // Always return HTTP 200 immediately to prevent provider retries with jobId
    return NextResponse.json({ success: true, jobId: queueResult.jobId }, { status: 200 });

  } else {
    logger.debug({
      channel,
      event: 'message_ignored',
      reason: 'No parseable payload or non-message update',
    });
    // Return 200 so Telegram doesn't retry ignored messages
    return NextResponse.json({ success: true }, { status: 200 });
  }
}
