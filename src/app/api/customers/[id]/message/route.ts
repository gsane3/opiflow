// POST /api/customers/[id]/message  → send a free-text message to the customer
// via their preferred channel (Viber → SMS fallback) and log it to the timeline.
//
// This is the foundation for snippets, AI-reply drafts, and scheduled messages.
// Review-first invariant is preserved at the UI layer: the operator always
// reviews the exact text and taps send; this endpoint performs the actual send.
//
// body: { text: string, channel?: 'auto'|'sms'|'viber' }

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';

export const runtime = 'nodejs';

const MAX_TEXT = 1000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'empty_text' }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ ok: false, error: 'too_long' }, { status: 400 });
  const channelOverride = raw.channel === 'sms' || raw.channel === 'viber' ? raw.channel : null;
  const workFolderId = typeof raw.workFolderId === 'string' && raw.workFolderId.trim() ? raw.workFolderId.trim() : null;

  // Load the customer (scoped to this business) for phone + preferred channel.
  const { data: customer } = await supabase
    .from('customers')
    .select('id, phone, mobile_phone, landline_phone, preferred_contact_method')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  if (!customer) {
    return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
  }
  const c = customer as {
    phone: string | null; mobile_phone: string | null; landline_phone: string | null; preferred_contact_method: string | null;
  };
  const phone = c.mobile_phone || c.phone || c.landline_phone;
  if (!phone) {
    return NextResponse.json({ ok: false, error: 'no_phone' }, { status: 400 });
  }

  // If filing into a project, verify the folder belongs to this business + customer
  // before tagging (so the message shows in the right project's portal chat).
  let folderTag: string | null = null;
  if (workFolderId) {
    const { data: f } = await supabase
      .from('work_folders')
      .select('id')
      .eq('id', workFolderId)
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (f) folderTag = workFolderId;
  }

  const referenceId = `msg:${businessId.slice(0, 8)}:${customerId.slice(0, 8)}:${Date.now().toString(36)}`;
  const result = await sendViaPreferredChannel({
    preferred: channelOverride ?? c.preferred_contact_method,
    phone,
    text,
    customerId,
    referenceId,
  });

  if (!result.ok || result.channel === 'none') {
    return NextResponse.json(
      { ok: false, error: 'send_failed', reason: result.reason ?? 'unknown' },
      { status: 502 }
    );
  }

  const detail = result.channel === 'sms' ? result.sms : result.viber;
  const { providerRequestId, providerMessageId } = extractProviderIds(detail);
  await recordOutboundMessage({
    businessId,
    customerId,
    channel: result.channel,
    summary: text,
    phone,
    referenceId,
    providerRequestId,
    providerMessageId,
    workFolderId: folderTag,
  });

  return NextResponse.json({ ok: true, channel: result.channel, fallbackApplied: result.fallbackApplied });
}
