import { z } from 'zod';

export const ChannelTypeSchema = z.enum(['telegram', 'whatsapp', 'slack']);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

export const CommandTypeSchema = z.enum(['profile_summary', 'send_connection', 'draft_message', 'unknown']);
export type CommandType = z.infer<typeof CommandTypeSchema>;

export const ChannelMessageSchema = z.object({
  userId: z.string(),
  channelType: ChannelTypeSchema,
  rawText: z.string(),
  commandType: CommandTypeSchema,
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ChannelMessage = z.infer<typeof ChannelMessageSchema>;

export interface BaseChannelAdapter {
  validateSecret(req: Request): boolean | Promise<boolean>;
  parsePayload(req: Request): Promise<ChannelMessage | null>;
  formatResponse?(data: any): any;
}
