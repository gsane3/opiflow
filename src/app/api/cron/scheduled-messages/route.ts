// Cron: dispatch due scheduled messages (F4).
//
// Sends every pending scheduled_messages row whose scheduled_for has passed,
// via the customer's preferred channel (Viber → SMS), logs it to the timeline,
// and marks it sent/failed.
//
// NOTE on granularity: the current Vercel plan only allows DAILY crons, so a
// scheduled message is dispatched at the next daily run after its time (good
// enough for appointment reminders). Move to an hourly schedule on a Pro plan
// for finer timing.
//
// NOTE on auto-cancel-on-reply: Opiflow does not yet capture inbound customer
// replies, so "cancel if the customer replies first" is not implemented; the
// owner can cancel a pending message manually.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { log } from '@/lib/observability';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_LIMIT = 50;

export async function GET(request: NextRequest) {
  const denied = checkCronSecret(request, 'scheduled-messages cron');
  if (denied) return denied;

  let supabase: ReturnType<typeof createServerSupabaseClient>;
  try {
    supabase = createServerSupabaseClient();
  } catch {
    return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('scheduled_messages')
    .select('id, business_id, customer_id, channel, body')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    // ONLY a missing table (pre-044) is a benign skip. Any other error (timeout,
    // permission, connection) means the cron is actually broken — return 500 so
    // Vercel/monitoring see it instead of silently never sending due messages.
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return NextResponse.json({ ok: true, skipped: 'scheduled_messages_unavailable' });
    }
    log.error('cron_scheduled_messages_query_failed', { code: error.code });
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{ id: string; business_id: string; customer_id: string | null; channel: string; body: string }>;
  let sent = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Resolve the customer's phone + preferred channel at send time.
      let phone: string | null = null;
      let preferred: string | null = null;
      if (row.customer_id) {
        const { data: cust } = await supabase
          .from('customers')
          .select('phone, mobile_phone, landline_phone, preferred_contact_method')
          .eq('id', row.customer_id)
          .maybeSingle();
        const c = cust as { phone: string | null; mobile_phone: string | null; landline_phone: string | null; preferred_contact_method: string | null } | null;
        phone = c ? (c.mobile_phone || c.phone || c.landline_phone) : null;
        preferred = c?.preferred_contact_method ?? null;
      }

      if (!phone) {
        await supabase.from('scheduled_messages').update({ status: 'failed', error_message: 'no_phone', sent_at: new Date().toISOString() }).eq('id', row.id);
        failed += 1;
        continue;
      }

      const referenceId = `sched:${row.id.slice(0, 12)}`;
      const channelOverride = row.channel === 'sms' || row.channel === 'viber' ? row.channel : null;
      const result = await sendViaPreferredChannel({ preferred: channelOverride ?? preferred, phone, text: row.body, customerId: row.customer_id, referenceId });

      if (result.ok && result.channel !== 'none') {
        const detail = result.channel === 'sms' ? result.sms : result.viber;
        const ids = extractProviderIds(detail);
        await recordOutboundMessage({
          businessId: row.business_id,
          customerId: row.customer_id,
          channel: result.channel,
          summary: row.body,
          phone,
          referenceId,
          providerRequestId: ids.providerRequestId,
          providerMessageId: ids.providerMessageId,
        });
        await supabase.from('scheduled_messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id);
        sent += 1;
      } else {
        await supabase.from('scheduled_messages').update({ status: 'failed', error_message: result.reason ?? 'send_failed', sent_at: new Date().toISOString() }).eq('id', row.id);
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, examined: rows.length, sent, failed });
}
