// Device push-token registration — service. Parity-matched to /api/push/register.
//
// Validation throws AppError (invalid_token / invalid_platform); a DB error is NOT an
// error to the caller — it returns { status:'degraded' } so the route can answer 200
// with degraded:true (an older DB without migration 032 must never break app startup).

import { AppError } from '../../core/errors';
import type { TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type Ctx = TenantContext & {
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

const VALID_PLATFORMS = ['android', 'ios', 'web'] as const;

export type PushResult = { status: 'ok' } | { status: 'degraded' };

export async function registerDeviceToken(
  ctx: Ctx,
  body: { token?: string; platform?: string },
): Promise<PushResult> {
  const token = (body.token ?? '').trim();
  const platform = (body.platform ?? '').trim();
  if (!token || token.length > 4096) throw new AppError('invalid_token', 400);
  if (!(VALID_PLATFORMS as readonly string[]).includes(platform)) throw new AppError('invalid_platform', 400);

  try {
    const { error } = await ctx.supabase.from('device_push_tokens').upsert(
      {
        token,
        platform,
        user_id: ctx.userId,
        business_id: ctx.businessId,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    );
    return error ? { status: 'degraded' } : { status: 'ok' };
  } catch {
    return { status: 'degraded' };
  }
}

export async function unregisterDeviceToken(ctx: Ctx, body: { token?: string }): Promise<PushResult> {
  const token = (body.token ?? '').trim();
  if (!token) throw new AppError('invalid_token', 400);
  try {
    // Scoped to the caller so a user can only unregister their own token.
    await ctx.supabase.from('device_push_tokens').delete().eq('token', token).eq('user_id', ctx.userId);
    return { status: 'ok' };
  } catch {
    return { status: 'degraded' };
  }
}

// ---------------------------------------------------------------------------
// Test push — parity-matched to /api/push/test.
// ---------------------------------------------------------------------------
//
// The push lib (`src/lib/server/push`) imports via the `@/` alias, which the unit
// runner can't resolve. So we keep its TYPES via a type-only `import(...)` query
// (erased at compile time) and load its VALUES lazily, only when a dependency is not
// injected — tests always inject both, so the real lib never enters the test graph.

type PushLib = typeof import('../../../lib/server/push');
type SendResult = Awaited<ReturnType<PushLib['sendPushToUser']>>;

export type TestPushOutcome =
  | { configured: false }
  | { configured: true; result: SendResult };

/** Dependencies are injected so the route uses the real push lib while tests stay pure. */
export interface TestPushDeps {
  isPushEnabled?: PushLib['isPushEnabled'];
  sendPushToUser?: PushLib['sendPushToUser'];
}

/**
 * Send a test notification to the caller's OWN devices. When push is not configured
 * the route answers 200 with `push_not_configured` (never an error), so this returns
 * `{ configured: false }` rather than throwing.
 */
export async function sendTestPush(userId: string, deps: TestPushDeps = {}): Promise<TestPushOutcome> {
  let lib: PushLib | null = null;
  const getLib = async (): Promise<PushLib> => (lib ??= await import('../../../lib/server/push'));

  const enabled = (deps.isPushEnabled ?? (await getLib()).isPushEnabled)();
  if (!enabled) return { configured: false };

  const send = deps.sendPushToUser ?? (await getLib()).sendPushToUser;
  const result = await send(userId, {
    title: 'Opiflow',
    body: 'Οι ειδοποιήσεις δουλεύουν! 🎉',
    url: '/',
    data: { type: 'test' },
  });
  return { configured: true, result };
}
