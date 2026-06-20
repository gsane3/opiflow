// GET /api/calls/[id]/brief
//
// Powers the native "post-call card": after a call ends the client polls this
// with the communication id (returned by /api/calls/log or the outbound TwiML
// dial-time row) until the DETAILED transcript brief lands, then renders it +
// one-tap "next task" chips.
//
//   ready=false  → only the instant metadata brief exists; keep polling.
//   ready=true   → the recording→Deepgram→OpenAI transcript brief is attached
//                  (call_briefs.brief_kind='transcript' or the row's
//                  brief_created_at is set). Stop polling.
//
// suggestedActions are derived from the brief TEXT (deriveActionsFromBriefText)
// so they work even for an UNSAVED number with no customer row.
//
// Service-role bypasses RLS → every query is explicitly scoped by business_id.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { deriveActionsFromBriefText } from '@/lib/server/suggested-actions';

export const runtime = 'nodejs';

interface CommRow {
  id: string;
  customer_id: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  brief_created_at: string | null;
}

interface BriefRow {
  brief_kind: string;
  brief_text: string;
  created_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id } = await params;

  try {
    // Fetch the call row (business-scoped). brief_created_at may be absent on
    // pre-migration DBs — fall back to a column-less select so the card still works.
    let comm: CommRow | null = null;
    const withBriefCol = await supabase
      .from('communications')
      .select('id, customer_id, channel, direction, status, phone, summary, brief_created_at')
      .eq('id', id)
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .maybeSingle();

    if (withBriefCol.error) {
      const base = await supabase
        .from('communications')
        .select('id, customer_id, channel, direction, status, phone, summary')
        .eq('id', id)
        .eq('business_id', businessId)
        .eq('channel', 'call')
        .maybeSingle();
      if (base.error) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      comm = base.data ? ({ ...(base.data as object), brief_created_at: null } as CommRow) : null;
    } else {
      comm = (withBriefCol.data as unknown as CommRow | null) ?? null;
    }

    if (!comm) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    // Best brief for this call: a transcript brief wins over metadata.
    let briefKind: string | null = null;
    let briefText: string | null = null;
    const briefsRes = await supabase
      .from('call_briefs')
      .select('brief_kind, brief_text, created_at')
      .eq('business_id', businessId)
      .eq('communication_id', comm.id)
      .order('created_at', { ascending: true });

    // Only a TRANSCRIPT brief (real conversation) counts as an AI brief. Older
    // speculative 'metadata' briefs are ignored so they can never resurface.
    if (!briefsRes.error && Array.isArray(briefsRes.data)) {
      for (const b of briefsRes.data as unknown as BriefRow[]) {
        if (b.brief_kind === 'transcript') {
          briefKind = b.brief_kind;
          briefText = b.brief_text;
        }
      }
    }

    const summary = briefText ?? comm.summary ?? null;
    const ready = briefKind === 'transcript' || Boolean(comm.brief_created_at);

    // Customer name (if the call is linked) — lets the card branch saved/unsaved.
    let customerName: string | null = null;
    if (comm.customer_id) {
      const { data: cust } = await supabase
        .from('customers')
        .select('name, company_name')
        .eq('id', comm.customer_id)
        .eq('business_id', businessId)
        .maybeSingle();
      const c = cust as { name: string | null; company_name: string | null } | null;
      customerName = c?.name ?? c?.company_name ?? null;
    }

    const suggestedActions = deriveActionsFromBriefText(summary).map((a) => ({
      actionType: a.actionType,
      label: a.label,
    }));

    return NextResponse.json({
      ok: true,
      id: comm.id,
      ready,
      briefKind,
      summary,
      status: comm.status,
      direction: comm.direction,
      phone: comm.phone,
      customerId: comm.customer_id,
      customerName,
      suggestedActions,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
