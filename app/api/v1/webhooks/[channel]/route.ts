import { NextRequest, NextResponse } from 'next/server';
import { TelegramAdapter } from '@/lib/channels/telegram';
import { logger } from '@/lib/logger';
import { BaseChannelAdapter } from '@/types/gateway';

export async function POST(
  req: NextRequest,
  { params }: { params: { channel: string } }
) {
  const { channel } = params;

  logger.info({ channel, event: 'webhook_received' });

  let adapter: BaseChannelAdapter;

  // Dispatch based on channel parameter
  switch (channel.toLowerCase()) {
    case 'telegram':
      adapter = new TelegramAdapter();
      break;
    // other channels (whatsapp, slack) will be added here
    default:
      logger.warn({ channel, event: 'unsupported_channel' });
      return NextResponse.json(
        { error: `Unsupported channel: ${channel}` },
        { status: 400 }
      );
  }

  // Verify secret token (provider-specific)
  const isValid = await adapter.validateSecret(req);
  if (!isValid) {
    logger.warn({ channel, event: 'auth_failed' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse the payload into a normalized ChannelMessage
  const parsedMessage = await adapter.parsePayload(req);

  if (parsedMessage) {
    // In a real application, this is where we would ingest the parsedMessage
    // into a downstream queue (e.g., Redis, SQS, or Supabase queue)
    logger.info({
      channel,
      event: 'message_normalized',
      message: parsedMessage,
    });
  } else {
    logger.debug({
      channel,
      event: 'message_ignored',
      reason: 'No parseable payload or non-message update',
    });
  }

  // Always return HTTP 200 immediately to prevent provider retries
  return NextResponse.json({ success: true }, { status: 200 });
}
