// Durable job queue over the existing `jobs` table (migration 030, currently
// unwired). Lets the heavy call tail (transcription → AI brief → notify) run as
// retryable background jobs instead of inline in a webhook request. Overview #6.
//
// PR foundation (unwired): no route enqueues or drains this yet. Adoption ships a
// worker cron + per-business flag; until then this is dead-safe library code.
//
// Claiming is OPTIMISTIC (UPDATE ... WHERE status='pending' RETURNING) which is
// race-safe for a single worker. A stronger SELECT ... FOR UPDATE SKIP LOCKED RPC
// can replace claimDueJobs later for many concurrent workers.

import type { createServerSupabaseClient } from '../../lib/supabase/server';

type Client = ReturnType<typeof createServerSupabaseClient>;

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface JobRow {
  id: string;
  business_id: string | null;
  type: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  run_at: string;
  created_at: string;
  updated_at: string;
}

export interface EnqueueOptions {
  businessId?: string | null;
  /** ISO timestamp; when to first run. Default now. */
  runAt?: string;
}

export interface RunOptions {
  limit?: number;
  maxAttempts?: number;
  /** Base linear backoff per attempt, in ms. */
  backoffMs?: number;
}

export type JobHandler = (job: JobRow) => Promise<void>;

/** Enqueue a job. Returns its id, or null if the insert failed. */
export async function enqueueJob(
  client: Client,
  type: string,
  payload: unknown,
  opts: EnqueueOptions = {},
): Promise<string | null> {
  const { data, error } = await client
    .from('jobs')
    .insert({
      business_id: opts.businessId ?? null,
      type,
      payload,
      status: 'pending',
      run_at: opts.runAt ?? new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/** Claim up to `limit` due pending jobs, flipping each to 'processing'. */
export async function claimDueJobs(client: Client, limit = 10): Promise<JobRow[]> {
  const { data } = await client
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(limit);

  const candidates = ((data ?? []) as unknown[]).map((r) => r as JobRow);
  const claimed: JobRow[] = [];
  for (const job of candidates) {
    const { data: upd } = await client
      .from('jobs')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'pending') // optimistic guard: another worker may have grabbed it
      .select('id');
    if (Array.isArray(upd) && upd.length === 1) claimed.push({ ...job, status: 'processing' });
  }
  return claimed;
}

export async function markJobDone(client: Client, id: string): Promise<void> {
  await client
    .from('jobs')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', id);
}

/** Reschedule with linear backoff, or mark 'failed' once maxAttempts is reached. */
export async function markJobFailed(client: Client, job: JobRow, opts: RunOptions = {}): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoffMs = opts.backoffMs ?? 60_000;
  const attempts = (job.attempts ?? 0) + 1;

  if (attempts >= maxAttempts) {
    await client
      .from('jobs')
      .update({ status: 'failed', attempts, updated_at: new Date().toISOString() })
      .eq('id', job.id);
    return;
  }
  const nextRun = new Date(Date.now() + backoffMs * attempts).toISOString();
  await client
    .from('jobs')
    .update({ status: 'pending', attempts, run_at: nextRun, updated_at: new Date().toISOString() })
    .eq('id', job.id);
}

/** Drain due jobs through a handler registry. Returns processed/failed counts. */
export async function runDueJobs(
  client: Client,
  handlers: Record<string, JobHandler>,
  opts: RunOptions = {},
): Promise<{ processed: number; failed: number }> {
  const jobs = await claimDueJobs(client, opts.limit ?? 10);
  let processed = 0;
  let failed = 0;
  for (const job of jobs) {
    const handler = handlers[job.type];
    if (!handler) {
      await markJobFailed(client, job, opts);
      failed++;
      continue;
    }
    try {
      await handler(job);
      await markJobDone(client, job.id);
      processed++;
    } catch {
      await markJobFailed(client, job, opts);
      failed++;
    }
  }
  return { processed, failed };
}
