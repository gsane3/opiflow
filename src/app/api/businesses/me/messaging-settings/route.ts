// GET   /api/businesses/me/messaging-settings
// PATCH /api/businesses/me/messaging-settings
//
// Business hours + after-hours/missed-call auto-reply + weekly-summary toggle
// (migration 044). Kept SEPARATE from /api/businesses/me so that a not-yet-applied
// migration 044 can never break the critical onboarding-gating endpoint: every
// query here degrades gracefully (returns defaults / no-op) when the columns
// don't exist yet.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

interface BusinessHours {
  days: number[]; // ISO weekday 1=Mon..7=Sun
  open: string;   // "HH:MM"
  close: string;  // "HH:MM"
}

interface Settings {
  businessHours: BusinessHours | null;
  autoReplyEnabled: boolean;
  autoReplyText: string | null;
  weeklySummaryEnabled: boolean;
}

const DEFAULTS: Settings = {
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

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) {
    if (auth.error.status === 404) return NextResponse.json({ ok: true, settings: DEFAULTS }, { headers: NO_STORE });
    return auth.error;
  }
  const { supabase, businessId } = auth.ctx;

  const { data, error } = await supabase
    .from('businesses')
    .select('business_hours, auto_reply_enabled, auto_reply_text, weekly_summary_enabled')
    .eq('id', businessId)
    .maybeSingle();

  if (error || !data) {
    // pre-044 (columns missing) → safe defaults so Settings still renders.
    return NextResponse.json({ ok: true, settings: DEFAULTS, degraded: true }, { headers: NO_STORE });
  }
  const r = data as Record<string, unknown>;
  return NextResponse.json(
    {
      ok: true,
      settings: {
        businessHours: parseHours(r.business_hours),
        autoReplyEnabled: r.auto_reply_enabled === true,
        autoReplyText: typeof r.auto_reply_text === 'string' ? r.auto_reply_text : null,
        weeklySummaryEnabled: r.weekly_summary_enabled !== false,
      } satisfies Settings,
    },
    { headers: NO_STORE }
  );
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
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

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: false, error: 'no_fields' }, { status: 400 });
  }

  const { error } = await supabase.from('businesses').update(updates).eq('id', businessId);
  if (error) {
    return NextResponse.json(
      { ok: false, error: 'update_failed', hint: 'migration_044_pending' },
      { status: 503, headers: NO_STORE }
    );
  }
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
