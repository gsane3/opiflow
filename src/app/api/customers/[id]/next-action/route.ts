// /api/customers/[id]/next-action
//
// The single "Next Best Action" for a customer that has NO work folder yet (the
// fallback surface — once a folder exists, the recommendation lives at folder
// level and this returns null). Business-scoped via authenticateBusinessRequest
// (+ next_actions RLS). Tolerant of migration 054 not being applied yet.
//
//   GET   → { ok, action: ClientNextAction | null }
//   PATCH → mark the active action accepted | dismissed | snoozed | completed
//           body: { id: string, action: 'accept'|'dismiss'|'snooze'|'complete', snoozeMinutes?: number }

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  computeCustomerNextAction, applyNextActionLifecycle, isNextActionLifecycle,
} from '@/lib/server/next-action-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  try {
    const action = await computeCustomerNextAction(supabase, businessId, customerId);
    return NextResponse.json({ ok: true, action });
  } catch {
    return NextResponse.json({ ok: true, action: null });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  await params;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  const raw = body as Record<string, unknown>;

  const id = typeof raw.id === 'string' ? raw.id : null;
  const action = isNextActionLifecycle(raw.action) ? raw.action : null;
  if (!id || !action) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  const snoozeMinutes = typeof raw.snoozeMinutes === 'number' ? raw.snoozeMinutes : undefined;

  const res = await applyNextActionLifecycle(supabase, { businessId, id, action, snoozeMinutes });
  return NextResponse.json({ ok: res.ok });
}
