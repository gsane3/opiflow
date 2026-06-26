// CRM task get-by-id and patch endpoints (GET/PATCH /api/tasks/[id]).
//
// ADOPTED to the modular pattern (src/server/modules/tasks): thin adapter. The fetch
// and the full PATCH validation/build — exact error codes, every coercion quirk
// (dueTime ''→null, customerId/offerId null-or-string, auto completed_at), and the
// no-field-change "return current task" path — live in the service. Byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { getTask, updateTask } from '@/server/modules/tasks/tasks.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id } = await params;
    const task = await getTask(ctx, id);
    return ok({ task });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_json', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('invalid_json', 400);
  }

  try {
    const task = await updateTask(ctx, id, body as Record<string, unknown>);
    return ok({ task });
  } catch (err) {
    return handleApiError(err);
  }
}
