// GET    /api/team/invites — list pending invites (owner/admin)
// POST   /api/team/invites — create an invite {email, role}; returns the join link
// DELETE /api/team/invites — revoke an invite {id}
//
// ADOPTED to the modular pattern (src/server/modules/team): thin adapter. The invite
// listing/create/revoke (invalid_email/invalid_role/invalid_id + the degrade cases)
// live in the service. The manager gate (`forbidden` 403) and Cache-Control: no-store
// stay here. Responses byte-identical (incl. the ok:true degraded list).

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { isManager } from '@/lib/server/team-invites';
import { listInvites, createInvite, revokeInvite } from '@/server/modules/team/team.service';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  if (!isManager(ctx.role)) return noStore(fail('forbidden', 403));
  const result = await listInvites(ctx);
  if ('degraded' in result) {
    return NextResponse.json({ ok: true, invites: [], degraded: true }, { headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, invites: result.invites }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  if (!isManager(ctx.role)) return noStore(fail('forbidden', 403));

  let body: { email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return noStore(fail('invalid_json', 400));
  }

  try {
    const result = await createInvite(ctx, body.email, body.role);
    if ('degraded' in result) {
      return NextResponse.json({ ok: false, error: 'invite_failed', degraded: true }, { status: 200, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, invite: result.invite, joinUrl: result.joinUrl }, { headers: NO_STORE });
  } catch (err) {
    return noStore(handleApiError(err));
  }
}

export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  if (!isManager(ctx.role)) return noStore(fail('forbidden', 403));

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return noStore(fail('invalid_json', 400));
  }

  try {
    const result = await revokeInvite(ctx, body.id);
    if ('degraded' in result) {
      return NextResponse.json({ ok: true, degraded: true }, { headers: NO_STORE });
    }
    return noStore(ok({}));
  } catch (err) {
    return noStore(handleApiError(err));
  }
}
