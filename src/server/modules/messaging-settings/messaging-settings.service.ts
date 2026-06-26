// Messaging settings — service. Parity-matched to /api/businesses/me/messaging-settings.
//
// Business hours + after-hours/missed-call auto-reply + weekly-summary toggle (migration
// 044). Uses the `businesses` table directly (its PK *is* the id — no business_id column,
// so NOT tenantDb). Every read/write degrades gracefully when the 044 columns are absent.

import { AppError } from '../../core/errors';
import type { BusinessAuthContext } from '../../../lib/api/auth';

type Ctx = Pick<BusinessAuthContext, 'supabase' | 'businessId'>;

export interface BusinessHours {
  days: number[]; // ISO weekday 1=Mon..7=Sun
  open: string; // "HH:MM"
  close: string; // "HH:MM"
}

export interface MessagingSettings {
  businessHours: BusinessHours | null;
  autoReplyEnabled: boolean;
  autoReplyText: string | null;
  weeklySummaryEnabled: boolean;
}

export const MESSAGING_DEFAULTS: MessagingSettings = {
  businessHours: null,
  autoReplyEnabled: false,
  autoReplyText: null,
  weeklySummaryEnabled: true,
};

function parseHours(v: unknown): BusinessHours | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const days = Array.isArray(o.days) ? o.days.filter((d): d is number => typeof d === 'number' && d >= 1 && d <= 7) : [];
  const open = typeof o.open === 'string' && /^\d{2}:\d{2}$/.test(o.open) ? o.open : null;
  const close = typeof o.close === 'string' && /^\d{2}:\d{2}$/.test(o.close) ? o.close : null;
  if (days.length === 0 || !open || !close) return null;
  return { days, open, close };
}

/** GET — current settings; pre-044 (columns/row missing) → defaults + degraded:true. */
export async function getMessagingSettings(
  ctx: Ctx,
): Promise<{ settings: MessagingSettings; degraded?: true }> {
  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('business_hours, auto_reply_enabled, auto_reply_text, weekly_summary_enabled')
    .eq('id', ctx.businessId)
    .maybeSingle();

  if (error || !data) return { settings: MESSAGING_DEFAULTS, degraded: true };
  const r = data as Record<string, unknown>;
  return {
    settings: {
      businessHours: parseHours(r.business_hours),
      autoReplyEnabled: r.auto_reply_enabled === true,
      autoReplyText: typeof r.auto_reply_text === 'string' ? r.auto_reply_text : null,
      weeklySummaryEnabled: r.weekly_summary_enabled !== false,
    },
  };
}

/**
 * PATCH — partial update of the whitelisted fields. no_fields (400) when nothing
 * applies; { updated:false } when the write fails (pre-044 → 503 route-side).
 */
export async function updateMessagingSettings(
  ctx: Ctx,
  raw: Record<string, unknown>,
): Promise<{ updated: true } | { updated: false }> {
  const updates: Record<string, unknown> = {};
  if ('businessHours' in raw) {
    updates.business_hours = raw.businessHours === null ? null : parseHours(raw.businessHours);
  }
  if ('autoReplyEnabled' in raw) updates.auto_reply_enabled = raw.autoReplyEnabled === true;
  if ('autoReplyText' in raw) {
    const t = typeof raw.autoReplyText === 'string' ? raw.autoReplyText.trim() : '';
    updates.auto_reply_text = t.length > 0 ? t.slice(0, 600) : null;
  }
  if ('weeklySummaryEnabled' in raw) updates.weekly_summary_enabled = raw.weeklySummaryEnabled === true;

  if (Object.keys(updates).length === 0) throw new AppError('no_fields', 400);

  const { error } = await ctx.supabase.from('businesses').update(updates).eq('id', ctx.businessId);
  if (error) return { updated: false };
  return { updated: true };
}
