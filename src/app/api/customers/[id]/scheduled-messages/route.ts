// GET  /api/customers/[id]/scheduled-messages  → pending scheduled messages
// POST /api/customers/[id]/scheduled-messages  → schedule { text, scheduledFor, channel? }
//
// ADOPTED to the modular pattern (src/server/modules/scheduled-messages): thin adapter.
// The list (pre-044 → empty) and the schedule validation (empty_text/too_long/
// invalid_date/past_date/customer_not_found/no_phone) live in the service; the route
// preserves the 503 schedule_failed + hint:migration_044_pending on a failed insert.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { listScheduledMessages, scheduleMessage } from '@/server/modules/scheduled-messages/scheduled-messages.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id: customerId } = await params;
  const messages = await listScheduledMessages(ctx, customerId);
  return ok({ messages });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  const { id: customerId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_json', 400);
  }

  try {
    const result = await scheduleMessage(ctx, customerId, body as Record<string, unknown>);
    if (!result.scheduled) {
      return NextResponse.json({ ok: false, error: 'schedule_failed', hint: 'migration_044_pending' }, { status: 503 });
    }
    return ok({ id: result.id });
  } catch (err) {
    return handleApiError(err);
  }
}
