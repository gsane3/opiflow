// GET   /api/customers/[id]/suggested-actions  → pending actions (newest first)
// POST  /api/customers/[id]/suggested-actions  → derive from an AI result + replace set
// PATCH /api/customers/[id]/suggested-actions  → mark one action done/dismissed
//
// ADOPTED to the modular pattern (src/server/modules/suggested-actions): thin adapter.
// The list/derive-replace/mark logic + the exact codes (query_failed, invalid_body,
// customer_not_found, insert_failed, update_failed) live in the service. The POST/PATCH
// 415 content-type guard stays route-side. Responses byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import {
  listSuggestedActions,
  deriveAndReplaceActions,
  updateSuggestedAction,
} from '@/server/modules/suggested-actions/suggested-actions.service';

export const runtime = 'nodejs';

function requireJson(request: NextRequest): boolean {
  return (request.headers.get('content-type') ?? '').includes('application/json');
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id: customerId } = await params;
    const actions = await listSuggestedActions(ctx, customerId);
    return ok({ actions });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireJson(request)) return fail('unsupported_content_type', 415);

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
    return fail('invalid_body', 400);
  }
  if (typeof body !== 'object' || body === null) return fail('invalid_body', 400);

  try {
    const result = await deriveAndReplaceActions(ctx, customerId, body as Record<string, unknown>);
    return ok({ inserted: result.inserted, actions: result.actions });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireJson(request)) return fail('unsupported_content_type', 415);

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
    return fail('invalid_body', 400);
  }
  if (typeof body !== 'object' || body === null) return fail('invalid_body', 400);

  try {
    await updateSuggestedAction(ctx, customerId, body as Record<string, unknown>);
    return ok({});
  } catch (err) {
    return handleApiError(err);
  }
}
