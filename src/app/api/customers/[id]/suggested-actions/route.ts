// /api/customers/[id]/suggested-actions
//
// Persisted AI "next action" chips for a customer (table: suggested_actions,
// migration 041). All queries are business-scoped via authenticateBusinessRequest
// and the table's RLS (business_users membership).
//
//   GET   → pending actions for the customer (newest first)
//   POST  → derive actions from an AI review result and replace the pending set
//           body: { result: <AiReviewResult-ish> }
//   PATCH → mark one action done/dismissed
//           body: { id: string, status: 'done' | 'dismissed' }

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { deriveSuggestedActions, type LooseAiResult } from '@/lib/server/suggested-actions';

export const runtime = 'nodejs';

interface ActionRow {
  id: string;
  action_type: string;
  label: string;
  params: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

function jsonBodyGuard(request: NextRequest): NextResponse | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET — pending actions
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  try {
    const { data, error } = await supabase
      .from('suggested_actions')
      .select('id, action_type, label, params, status, created_at')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });

    const actions = ((data ?? []) as unknown as ActionRow[]).map((r) => ({
      id: r.id, actionType: r.action_type, label: r.label, params: r.params, createdAt: r.created_at,
    }));
    return NextResponse.json({ ok: true, actions });
  } catch {
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — derive from an AI result and replace the pending set
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = jsonBodyGuard(request);
  if (guard) return guard;

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  const raw = body as Record<string, unknown>;

  const derived = deriveSuggestedActions((raw.result ?? null) as LooseAiResult | null);
  if (derived.length === 0) return NextResponse.json({ ok: true, inserted: 0, actions: [] });

  try {
    // Verify the customer belongs to this business (defence-in-depth on top of RLS).
    const { data: cust } = await supabase
      .from('customers').select('id').eq('id', customerId).eq('business_id', businessId).maybeSingle();
    if (!cust) return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });

    // Supersede the existing pending set so chips reflect the latest brief.
    await supabase
      .from('suggested_actions')
      .update({ status: 'dismissed' })
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .eq('status', 'pending');

    const rows = derived.map((d) => ({
      business_id: businessId,
      customer_id: customerId,
      action_type: d.actionType,
      label: d.label,
      params: d.params,
      status: 'pending',
    }));

    const { data, error } = await supabase
      .from('suggested_actions')
      .insert(rows)
      .select('id, action_type, label, params, status, created_at');

    if (error) return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });

    const actions = ((data ?? []) as unknown as ActionRow[]).map((r) => ({
      id: r.id, actionType: r.action_type, label: r.label, params: r.params, createdAt: r.created_at,
    }));
    return NextResponse.json({ ok: true, inserted: actions.length, actions });
  } catch {
    return NextResponse.json({ ok: false, error: 'insert_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — mark one action done/dismissed
// ---------------------------------------------------------------------------

const VALID_PATCH_STATUS = ['done', 'dismissed'] as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = jsonBodyGuard(request);
  if (guard) return guard;

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  const raw = body as Record<string, unknown>;

  const actionId = typeof raw.id === 'string' ? raw.id : null;
  const status = typeof raw.status === 'string' && (VALID_PATCH_STATUS as readonly string[]).includes(raw.status) ? raw.status : null;
  if (!actionId || !status) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });

  try {
    const { error } = await supabase
      .from('suggested_actions')
      .update({ status })
      .eq('id', actionId)
      .eq('business_id', businessId)
      .eq('customer_id', customerId);

    if (error) return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'update_failed' }, { status: 500 });
  }
}
