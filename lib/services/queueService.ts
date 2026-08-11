import { createServerSupabaseClient } from '../supabase/server';
import { ChannelMessage } from '@/types/gateway';

export async function enqueueJob(
  message: ChannelMessage,
  userId: string,
  sourceChannelId: string
): Promise<{ success: boolean; jobId?: string; error?: string }> {
  const supabase = createServerSupabaseClient();

  // 1. Check credit balance
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('credit_balance')
    .eq('id', userId)
    .single();

  if (userError || !user) {
    return { success: false, error: 'User not found or error fetching credits' };
  }

  if (user.credit_balance < 1) {
    return { success: false, error: 'Insufficient credits' };
  }

  // 2. Insert into job_queue
  const { data: job, error: jobError } = await supabase
    .from('job_queue')
    .insert({
      user_id: userId,
      source_channel_id: sourceChannelId,
      status: 'pending',
      action_type: message.commandType,
      payload: message,
      // scheduled_at defaults to NOW() based on DB schema
    })
    .select('id')
    .single();

  if (jobError || !job) {
     return { success: false, error: 'Failed to enqueue job' };
  }

  // 3. Deduct credit and log token ledger
  // Note: For absolute safety, these could be another RPC transaction,
  // but sequential calls are acceptable here given the requirements.
  await supabase
    .from('users')
    .update({ credit_balance: user.credit_balance - 1 })
    .eq('id', userId);

  await supabase
    .from('token_ledger')
    .insert({
      user_id: userId,
      amount: -1,
      description: `Job queued: ${message.commandType}`,
    });

  return { success: true, jobId: job.id };
}
