// Team — service (members, invites, invite acceptance). Parity-matched to
// /api/team/members, /api/team/invites, /api/team/accept.
//
// The manager gate (isManager → `forbidden` 403) and the `Cache-Control: no-store`
// header stay in the thin routes (they're a different code than assertManager's
// forbidden_admin_only, and every team response is no-store). Validation throws the
// route's exact codes; the degraded (200 + degraded:true) cases are signalled via a
// return value so the route can build them. acceptInvite takes a raw client because
// its route authenticates a user who may not yet belong to any business.

import { AppError } from '../../core/errors';
import type { BusinessAuthContext } from '../../../lib/api/auth';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { generateInviteToken, buildJoinUrl, hashInviteToken } from '../../../lib/server/team-invites';

type ServerClient = ReturnType<typeof createServerSupabaseClient>;

export type TeamContext = BusinessAuthContext;

export interface TeamMember {
  userId: string;
  email: string | null;
  role: string;
  isYou: boolean;
}

const VALID_INVITE_ROLES = ['admin', 'member'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --- members -------------------------------------------------------------

export async function listMembers(
  ctx: TeamContext,
): Promise<{ degraded: true } | { members: TeamMember[]; yourRole: string }> {
  try {
    const { data, error } = await ctx.supabase
      .from('business_users')
      .select('user_id, role, accepted_at, created_at')
      .eq('business_id', ctx.businessId)
      .order('created_at', { ascending: true });
    if (error) return { degraded: true };
    const rows = (data ?? []) as Array<{ user_id: string; role: string; accepted_at: string | null }>;
    const members = await Promise.all(
      rows.map(async (r) => {
        let email: string | null = null;
        try {
          const { data: u } = await ctx.supabase.auth.admin.getUserById(r.user_id);
          email = u?.user?.email ?? null;
        } catch {
          // show the row without an email rather than failing the list
        }
        return { userId: r.user_id, email, role: r.role, isYou: r.user_id === ctx.userId };
      }),
    );
    return { members, yourRole: ctx.role };
  } catch {
    return { degraded: true };
  }
}

export async function removeMember(
  ctx: TeamContext,
  userId?: string,
): Promise<{ removed: true } | { degraded: true }> {
  const target = (userId ?? '').trim();
  if (!target) throw new AppError('invalid_user', 400);
  if (target === ctx.userId) throw new AppError('cannot_remove_self', 400);
  try {
    // Never remove an owner via this endpoint.
    const { data: targetRow } = await ctx.supabase
      .from('business_users')
      .select('role')
      .eq('business_id', ctx.businessId)
      .eq('user_id', target)
      .maybeSingle();
    if ((targetRow as { role?: string } | null)?.role === 'owner') {
      throw new AppError('cannot_remove_owner', 400);
    }
    await ctx.supabase.from('business_users').delete().eq('business_id', ctx.businessId).eq('user_id', target);
    return { removed: true };
  } catch (err) {
    if (err instanceof AppError) throw err; // cannot_remove_owner must surface as 400, not degraded
    return { degraded: true };
  }
}

// --- invites -------------------------------------------------------------

export async function listInvites(
  ctx: TeamContext,
): Promise<{ degraded: true } | { invites: unknown[] }> {
  try {
    const { data, error } = await ctx.supabase
      .from('business_invites')
      .select('id, email, role, status, created_at, expires_at')
      .eq('business_id', ctx.businessId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return { degraded: true };
    return { invites: data ?? [] };
  } catch {
    return { degraded: true };
  }
}

export async function createInvite(
  ctx: TeamContext,
  rawEmail?: string,
  rawRole?: string,
): Promise<{ degraded: true } | { invite: unknown; joinUrl: string }> {
  const email = (rawEmail ?? '').trim().toLowerCase();
  const inviteRole = (rawRole ?? 'member').trim();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new AppError('invalid_email', 400);
  if (!(VALID_INVITE_ROLES as readonly string[]).includes(inviteRole)) throw new AppError('invalid_role', 400);

  try {
    const { raw, hash } = generateInviteToken();
    // Supersede any prior pending invite for the same email in this business.
    await ctx.supabase
      .from('business_invites')
      .update({ status: 'revoked' })
      .eq('business_id', ctx.businessId)
      .eq('email', email)
      .eq('status', 'pending');

    const { data, error } = await ctx.supabase
      .from('business_invites')
      .insert({ business_id: ctx.businessId, email, role: inviteRole, token_hash: hash, invited_by: ctx.userId })
      .select('id, email, role')
      .single();
    if (error || !data) return { degraded: true };
    return { invite: data, joinUrl: buildJoinUrl(raw) };
  } catch {
    return { degraded: true };
  }
}

export async function revokeInvite(
  ctx: TeamContext,
  rawId?: string,
): Promise<{ revoked: true } | { degraded: true }> {
  const id = (rawId ?? '').trim();
  if (!id) throw new AppError('invalid_id', 400);
  try {
    await ctx.supabase
      .from('business_invites')
      .update({ status: 'revoked' })
      .eq('id', id)
      .eq('business_id', ctx.businessId);
    return { revoked: true };
  } catch {
    return { degraded: true };
  }
}

// --- accept (own auth; user may not belong to a business yet) ------------

export type AcceptResult =
  | { ok: true; businessId: string; role: string }
  | { ok: false; error: 'invite_invalid'; status: 404 }
  | { ok: false; error: 'invite_expired'; status: 410 }
  | { ok: false; error: 'wrong_account'; status: 403; invitedEmail: string }
  | { ok: false; error: 'accept_failed'; status: 500 };

export async function acceptInvite(
  supabase: ServerClient,
  userId: string,
  email: string | null,
  rawToken: string,
): Promise<AcceptResult> {
  const nowIso = new Date().toISOString();
  const { data: inviteData } = await supabase
    .from('business_invites')
    .select('id, business_id, email, role, status, expires_at')
    .eq('token_hash', hashInviteToken(rawToken))
    .maybeSingle();
  const invite = inviteData as
    | { id: string; business_id: string; email: string; role: string; status: string; expires_at: string }
    | null;

  if (!invite || invite.status !== 'pending') return { ok: false, error: 'invite_invalid', status: 404 };
  if (invite.expires_at <= nowIso) return { ok: false, error: 'invite_expired', status: 410 };
  if (!email || email !== invite.email.toLowerCase()) {
    return { ok: false, error: 'wrong_account', status: 403, invitedEmail: invite.email };
  }

  // Create the membership (idempotent on the PK).
  const { error: memberError } = await supabase.from('business_users').upsert(
    {
      business_id: invite.business_id,
      user_id: userId,
      role: invite.role,
      accepted_at: nowIso,
    },
    { onConflict: 'business_id,user_id' },
  );
  if (memberError) return { ok: false, error: 'accept_failed', status: 500 };

  await supabase.from('business_invites').update({ status: 'accepted', accepted_at: nowIso }).eq('id', invite.id);

  return { ok: true, businessId: invite.business_id, role: invite.role };
}
