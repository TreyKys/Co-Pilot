import { createServerSupabaseClient } from '../supabase/server';

export async function getOrCreateUserByChannel(
  provider: string,
  providerChatId: string
): Promise<{ userId: string; userChannelId: string } | null> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase.rpc('get_or_create_user_by_channel', {
    p_provider: provider,
    p_provider_chat_id: providerChatId,
  });

  if (error) {
    console.error('Error in getOrCreateUserByChannel:', error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  return {
    userId: data[0].user_id,
    userChannelId: data[0].user_channel_id,
  };
}
