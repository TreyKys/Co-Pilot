import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../../lib/supabase/server';
import { logger } from '../../../../../lib/logger';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const apiKey = authHeader.replace('Bearer ', '');

    const supabase = createServerSupabaseClient();

    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('user_id')
      .eq('key', apiKey)
      .single();

    if (keyError || !keyData) {
       return NextResponse.json({ error: 'Invalid API Key' }, { status: 401 });
    }

    const userId = keyData.user_id;
    const jobId = params.id;

    const { data: job, error: jobError } = await supabase
      .from('job_queue')
      .select('id, status, result_payload, created_at, completed_at, user_id')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Ensure the job belongs to the authenticated user
    if (job.user_id !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Mask user_id before returning
    const { user_id, ...safeJobInfo } = job;

    return NextResponse.json(safeJobInfo, { status: 200 });

  } catch (error: any) {
    logger.error({ event: 'job_polling_api_error', error: error.message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
