// GET    /api/team/members  — list the business's members (+ emails, roles)
// DELETE /api/team/members  — remove a member (owner/admin only; not the owner/self)
//
// ADOPTED to the modular pattern (src/server/modules/team): thin adapter. The member
// listing (incl. email lookups) and the remove logic (invalid_user/cannot_remove_self/
// cannot_remove_owner + the team_unavailable degrade) live in the service. The manager
// gate (`forbidden` 403) and Cache-Control: no-store stay here. Responses byte-identical.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { isManager } from '@/lib/server/team-invites';
import { listMembers, removeMember } from '@/server/modules/team/team.service';

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
  const result = await listMembers(ctx);
  if ('degraded' in result) {
    return NextResponse.json({ ok: false, error: 'team_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, members: result.members, yourRole: result.yourRole }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  if (!isManager(ctx.role)) return noStore(fail('forbidden', 403));

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return noStore(fail('invalid_json', 400));
  }

  try {
    const result = await removeMember(ctx, body.userId);
    if ('degraded' in result) {
      return NextResponse.json({ ok: false, error: 'team_unavailable', degraded: true }, { status: 200, headers: NO_STORE });
    }
    return noStore(ok({}));
  } catch (err) {
    return noStore(handleApiError(err));
  }
}
