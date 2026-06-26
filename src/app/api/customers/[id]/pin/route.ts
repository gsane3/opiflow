// POST /api/customers/[id]/pin  → { pinned: boolean }
//
// ADOPTED to the modular pattern (src/server/modules/customers): thin adapter. The
// tenant-scoped pin write lives in the service; the route preserves the exact
// behaviour, incl. the 503 update_failed + hint:migration_044_pending when the
// pinned column (migration 044) does not exist yet.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { pinCustomer } from '@/server/modules/customers/customers.service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const pinned = (body as { pinned?: unknown }).pinned === true;

  const succeeded = await pinCustomer(ctx, id, pinned);
  if (!succeeded) {
    return NextResponse.json({ ok: false, error: 'update_failed', hint: 'migration_044_pending' }, { status: 503 });
  }
  return ok({ pinned });
}
