// /api/folders/[id]/next-action
//
// The single "Next Best Action" for one work folder (Έργο). Business-scoped via
// authenticateBusinessRequest (+ next_actions RLS). The recommendation is computed
// deterministically from existing signals and persisted (one active per folder).
// Tolerant of migration 054 not being applied yet → returns a computed-only action.
//
//   GET   → { ok, action: ClientNextAction | null }
//   PATCH → mark the active action accepted | dismissed | snoozed | completed
//           body: { id: string, action: 'accept'|'dismiss'|'snooze'|'complete', snoozeMinutes?: number }

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  computeFolderNextAction, applyNextActionLifecycle, isNextActionLifecycle,
} from '@/lib/server/next-action-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: folderId } = await params;

  try {
    const action = await computeFolderNextAction(supabase, businessId, folderId);
    return NextResponse.json({ ok: true, action });
  } catch {
    // Never break the folder view because of the recommendation engine.
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
  await params; // folderId not needed — the action id + business scope are authoritative.

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
