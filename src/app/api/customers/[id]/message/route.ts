// POST /api/customers/[id]/message  → send a free-text message to the customer
// via their preferred channel (Viber → SMS fallback) and log it to the timeline.
//
// This is the foundation for snippets, AI-reply drafts, and scheduled messages.
// Review-first invariant is preserved at the UI layer: the operator always
// reviews the exact text and taps send; this endpoint performs the actual send.
//
// body: { text: string, channel?: 'auto'|'sms'|'viber' }
//
// ADOPTED to the modular pattern (src/server/modules/customer-message): thin
// adapter. Bearer auth + the raw JSON parse stay here; the post-parse validation,
// the business-scoped customer/work-folder reads, the send orchestration and the
// timeline log live in the service (effectful libs injected). Responses are
// byte-identical.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';
import { sendCustomerMessage } from '@/server/modules/customer-message/customer-message.service';

export const runtime = 'nodejs';

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

  const { payload, status } = await sendCustomerMessage(
    { supabase, userId: auth.ctx.userId, businessId, role: auth.ctx.role },
    customerId,
    body,
    { sendViaPreferredChannel, extractProviderIds, recordOutboundMessage },
  );
  return NextResponse.json(payload, { status });
}
