import { BaseChannelAdapter, ChannelMessage, CommandType } from '@/types/gateway';
import { timingSafeEqual } from 'crypto';
import { Update } from 'grammy/types';
import { logger } from '../logger';

export class TelegramAdapter implements BaseChannelAdapter {
  private readonly secretToken: string;

  constructor() {
    this.secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || '';
  }

  validateSecret(req: Request): boolean {
    const tokenHeader = req.headers.get('X-Telegram-Bot-Api-Secret-Token');

    if (!tokenHeader || !this.secretToken) {
      logger.warn({ event: 'telegram_auth_failed', reason: 'missing_token' });
      return false;
    }

    try {
      // Pad buffers to avoid length mismatch errors with timingSafeEqual
      const headerBuffer = Buffer.from(tokenHeader, 'utf-8');
      const secretBuffer = Buffer.from(this.secretToken, 'utf-8');

      if (headerBuffer.length !== secretBuffer.length) {
         logger.warn({ event: 'telegram_auth_failed', reason: 'length_mismatch' });
         return false;
      }

      return timingSafeEqual(headerBuffer, secretBuffer);
    } catch (error) {
      logger.error({ event: 'telegram_auth_error', error: String(error) });
      return false;
    }
  }

  async parsePayload(req: Request): Promise<ChannelMessage | null> {
    try {
      const update = (await req.json()) as Update;

      // Ensure it's a message update
      if (!update.message || !update.message.text) {
        return null;
      }

      const text = update.message.text.trim();
      const userId = update.message.from?.id.toString();

      if (!userId) {
        logger.warn({ event: 'telegram_parse_failed', reason: 'missing_user_id', updateId: update.update_id });
        return null;
      }

      const commandType = this.determineCommandType(text);

      return {
        userId,
        channelType: 'telegram',
        rawText: text,
        commandType,
        metadata: {
          chatId: update.message.chat.id.toString(),
          messageId: update.message.message_id,
          username: update.message.from?.username,
        }
      };
    } catch (error) {
       logger.error({ event: 'telegram_parse_error', error: String(error) });
       return null;
    }
  }

  private determineCommandType(text: string): CommandType {
    // Simple mock logic for determining command type based on text.
    // Real implementation would likely be more robust.
    const lowerText = text.toLowerCase();

    if (lowerText.startsWith('/summary') || lowerText.includes('summarize')) {
      return 'profile_summary';
    }

    if (lowerText.startsWith('/connect') || lowerText.includes('connect')) {
      return 'send_connection';
    }

    if (lowerText.startsWith('/draft') || lowerText.includes('draft')) {
      return 'draft_message';
    }

    return 'unknown';
  }
}
