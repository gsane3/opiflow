// CRM customer get-by-id, patch, and delete endpoints (GET/PATCH/DELETE /api/customers/[id]).
//
// ADOPTED to the modular pattern (src/server/modules/customers): thin adapter. The
// detail fetch (+ the tolerant pinned/053/058 reads), the PATCH whitelist + the
// isolated extras/blocked writes, and the single-contact delete live in the service.
// Responses are byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { getCustomer, updateCustomer, deleteCustomer } from '@/server/modules/customers/customers.service';

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
    const customer = await getCustomer(ctx, id);
    return ok({ customer });
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
    const customer = await updateCustomer(ctx, id, body as Record<string, unknown>);
    return ok({ customer });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const { id } = await params;
    const result = await deleteCustomer(ctx, id);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
