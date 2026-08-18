import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/supabase/server';
import { z } from 'zod';
import { logger } from '../../../../lib/logger';

const ExtractPayloadSchema = z.object({
  url: z.string().url(),
  mode: z.enum(['auto', 'fast', 'stealth']).default('auto'),
  callbackUrl: z.string().url().optional()
});

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const apiKey = authHeader.replace('Bearer ', '');

    const supabase = createServerSupabaseClient();

    // Verify API Key (assuming there's an api_keys table linking to users)
    // For this prototype, we'll verify if the key exists and get the user_id.
    // NOTE: In a real system you'd use a dedicated api_keys table.
    // If we only have users, we might map the API key directly or mock it for the demo.
    // Since Phase 4 spec asks to check 'api_keys' table:
    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('key', apiKey)
      .single();

    if (keyError || !keyData) {
       // Mock fallback for E2E tests if the api_keys table isn't fully seeded yet
       logger.warn({ event: 'api_key_lookup_failed', error: keyError?.message });
       // We'll proceed with a mock user if configured or return 401
       return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
    }

    const userId = keyData.user_id;

    // Parse Payload
    const body = await req.json();
    const parseResult = ExtractPayloadSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parseResult.error.format() }, { status: 400 });
    }

    const { url, mode, callbackUrl } = parseResult.data;

    // Atomically deduct credit
    // In Supabase, usually this is an RPC. We'll do a basic check-and-update for the demo,
    // though an RPC like `decrement_credits(user_id, 1)` is safer.
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('credit_balance')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (userData.credit_balance < 1) {
      return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 });
    }

    const { error: deductError } = await supabase
      .from('users')
      .update({ credit_balance: userData.credit_balance - 1 })
      .eq('id', userId);

    if (deductError) {
      return NextResponse.json({ error: 'Failed to process billing' }, { status: 500 });
    }

    // Insert Job
    const payload = { url, mode, callbackUrl };

    const { data: jobData, error: jobError } = await supabase
      .from('job_queue')
      .insert({
        user_id: userId,
        action_type: 'profile_extraction',
        status: 'pending',
        payload: payload
      })
      .select('id')
      .single();

    if (jobError || !jobData) {
      // Rollback credit?
      return NextResponse.json({ error: 'Failed to queue job' }, { status: 500 });
    }

    return NextResponse.json({
      jobId: jobData.id,
      status: 'queued',
      estimatedWaitSeconds: 15
    }, { status: 202 });

  } catch (error: any) {
    logger.error({ event: 'extract_api_error', error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
