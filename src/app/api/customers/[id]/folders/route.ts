// Έργα (work folders) for one customer — authenticated business API.
//
//   GET  /api/customers/[id]/folders  → list this customer's folders (+ counts)
//   POST /api/customers/[id]/folders  → create a folder for this customer
//
// Service-role client bypasses RLS, so EVERY query is explicitly scoped by
// business_id (and customer_id). Requires migration 046 (work_folders +
// work_folder_id columns). Raw DB errors are never returned to the caller.
//
// Thin adapter: auth (requireBusinessUser, byte-equivalent to
// authenticateBusinessRequest) + request parsing live here; the post-auth DB/business
// logic lives in src/server/modules/customer-folders. Every status/code/shape is
// byte-identical to the original route.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { fail, handleApiError, ok } from '@/server/core/errors';
import {
  createCustomerFolder,
  listCustomerFolders,
} from '@/server/modules/customer-folders/customer-folders.service';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/customers/[id]/folders
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireBusinessUser(request);
    const { id: customerId } = await params;
    const folders = await listCustomerFolders(ctx, customerId);
    return ok({ folders });
  } catch (err) {
    return handleApiError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/folders
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return fail('unsupported_content_type', 415);
  }

  try {
    const ctx = await requireBusinessUser(request);
    const { id: customerId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail('invalid_json', 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail('invalid_json', 400);
    }
    const raw = body as Record<string, unknown>;

    const folder = await createCustomerFolder(ctx, customerId, raw);
    return ok({ folder });
  } catch (err) {
    return handleApiError(err);
  }
}
