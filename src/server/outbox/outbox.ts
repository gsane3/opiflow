// Transactional Outbox for OUTBOUND side-effects (Viber/SMS/email/webhooks).
//
// PR foundation (unwired). Record the intent first (record), then a worker drains
// due events through a per-kind sender (dispatch) with retries. A caller-supplied
// dedup_key makes record() idempotent, so a retried request or a redelivered
// upstream webhook never sends the same message twice. Overview #7.
//
// Backed by the outbox_events table (migration 063). No route writes this yet.

import type { createServerSupabaseClient } from '../../lib/supabase/server';

type Client = ReturnType<typeof createServerSupabaseClient>;

export type OutboxStatus = 'pending' | 'processing' | 'sent' | 'failed';

export interface OutboxRow {
  id: string;
  business_id: string | null;
  kind: string;
  dedup_key: string | null;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  next_retry_at: string;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordOptions {
  businessId?: string | null;
  /** Idempotency key; a repeat record() with the same (businessId, dedupKey) is a no-op. */
  dedupKey?: string;
}

export interface DispatchOptions {
  limit?: number;
  maxAttempts?: number;
  backoffMs?: number;
}

export type OutboxSender = (row: OutboxRow) => Promise<void>;

/**
 * Record an outbound event. Idempotent on (businessId, dedupKey): if the same key
 * was already recorded, returns the existing id with created=false (no new send).
 */
export async function recordOutbox(
  client: Client,
  kind: string,
  payload: unknown,
  opts: RecordOptions = {},
): Promise<{ id: string; created: boolean } | null> {
  const businessId = opts.businessId ?? null;
  const dedupKey = opts.dedupKey ?? null;

  const { data, error } = await client
    .from('outbox_events')
    .insert({ business_id: businessId, kind, dedup_key: dedupKey, payload, status: 'pending' })
    .select('id')
    .single();

  if (!error && data) return { id: (data as { id: string }).id, created: true };

  // Unique-violation on (business_id, dedup_key) → the event already exists.
  const code = (error as { code?: string } | null)?.code;
  if (code === '23505' && dedupKey) {
    let q = client
      .from('outbox_events')
      .select('id')
      .eq('kind', kind)
      .eq('dedup_key', dedupKey);
    q = businessId === null ? q.is('business_id', null) : q.eq('business_id', businessId);
    const { data: existing } = await q.maybeSingle();
    if (existing) return { id: (existing as { id: string }).id, created: false };
  }
  return null;
}

/** Claim up to `limit` due pending events, flipping each to 'processing'. */
export async function claimDueOutbox(client: Client, limit = 20): Promise<OutboxRow[]> {
  const { data } = await client
    .from('outbox_events')
    .select('*')
    .eq('status', 'pending')
    .lte('next_retry_at', new Date().toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(limit);

  const candidates = ((data ?? []) as unknown[]).map((r) => r as OutboxRow);
  const claimed: OutboxRow[] = [];
  for (const ev of candidates) {
    const { data: upd } = await client
      .from('outbox_events')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', ev.id)
      .eq('status', 'pending')
      .select('id');
    if (Array.isArray(upd) && upd.length === 1) claimed.push({ ...ev, status: 'processing' });
  }
  return claimed;
}

export async function markOutboxSent(client: Client, id: string): Promise<void> {
  const now = new Date().toISOString();
  await client
    .from('outbox_events')
    .update({ status: 'sent', sent_at: now, updated_at: now })
    .eq('id', id);
}

export async function markOutboxFailed(
  client: Client,
  row: OutboxRow,
  error: unknown,
  opts: DispatchOptions = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const backoffMs = opts.backoffMs ?? 60_000;
  const attempts = (row.attempts ?? 0) + 1;
  const lastError = error instanceof Error ? error.message : String(error);

  if (attempts >= maxAttempts) {
    await client
      .from('outbox_events')
      .update({ status: 'failed', attempts, last_error: lastError, updated_at: new Date().toISOString() })
      .eq('id', row.id);
    return;
  }
  const nextRetry = new Date(Date.now() + backoffMs * attempts).toISOString();
  await client
    .from('outbox_events')
    .update({
      status: 'pending',
      attempts,
      last_error: lastError,
      next_retry_at: nextRetry,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);
}

/** Drain due events through a per-kind sender registry. Returns sent/failed counts. */
export async function dispatchOutbox(
  client: Client,
  senders: Record<string, OutboxSender>,
  opts: DispatchOptions = {},
): Promise<{ sent: number; failed: number }> {
  const events = await claimDueOutbox(client, opts.limit ?? 20);
  let sent = 0;
  let failed = 0;
  for (const ev of events) {
    const sender = senders[ev.kind];
    if (!sender) {
      await markOutboxFailed(client, ev, new Error(`no sender for kind '${ev.kind}'`), opts);
      failed++;
      continue;
    }
    try {
      await sender(ev);
      await markOutboxSent(client, ev.id);
      sent++;
    } catch (err) {
      await markOutboxFailed(client, ev, err, opts);
      failed++;
    }
  }
  return { sent, failed };
}
