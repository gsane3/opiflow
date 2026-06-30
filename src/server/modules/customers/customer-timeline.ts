// Customer timeline — service. Parity-matched to GET /api/customers/[id]/timeline.
//
// The unified per-customer "chat" stream (redesign P3), derived at query time by merging
// communications + call_briefs, offers + offer responses, appointment tasks + responses,
// intake tokens, and upload sessions — all scoped by business_id + customer_id. The
// assembly is a faithful port of the live route; only the auth/response shell moved to the
// thin route. customer_not_found (404) before the build; timeline_query_failed (500) on
// any failure inside it; items are sorted oldest→newest and capped.

import { AppError } from '../../core/errors';
import { tenantDb, type TenantContext } from '../../core/tenant';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type Ctx = TenantContext & { supabase: ReturnType<typeof createServerSupabaseClient> };

const ITEM_LIMIT = 300;

type Side = 'us' | 'customer';
type ItemType =
  | 'call' | 'sms' | 'viber' | 'email'
  | 'offer' | 'offer_response'
  | 'appointment' | 'appointment_response'
  | 'intake_request' | 'intake_submitted'
  | 'upload' | 'invoice';

export interface TimelineItem {
  id: string;
  type: ItemType;
  side: Side;
  interactive: boolean;
  title: string;
  body: string | null;
  status: string | null;
  occurredAt: string;
  refTable: string | null;
  refId: string | null;
  payload?: Record<string, unknown>;
}

function fmtDateGr(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const ymd = dateStr.split('T')[0].split('-');
    if (ymd.length !== 3) return dateStr;
    return `${ymd[2]}-${ymd[1]}-${ymd[0]}`;
  } catch {
    return dateStr;
  }
}

export async function buildCustomerTimeline(
  ctx: Ctx,
  customerId: string,
): Promise<{ customer: { id: string; name: string }; items: TimelineItem[] }> {
  const businessId = ctx.businessId;
  const db = tenantDb(ctx.supabase, businessId);

  // Confirm the customer belongs to this business.
  const { data: customer } = await db.from('customers').byId(customerId, 'id, name, company_name, crm_number').maybeSingle();
  if (!customer) throw new AppError('customer_not_found', 404);

  const items: TimelineItem[] = [];

  try {
    const [rawCommsRes, rawBriefsRes, rawOffersRes, rawTasksRes, rawIntakeRes, rawUploadsRes] =
      await Promise.all([
        db.from('communications').select('id, channel, direction, status, summary, created_at')
          .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(ITEM_LIMIT),
        db.from('call_briefs').select('communication_id, brief_kind, brief_text, created_at')
          .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(ITEM_LIMIT),
        db.from('offers').select('id, offer_number, status, total, offer_date, created_at')
          .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(ITEM_LIMIT),
        db.from('tasks').select('id, title, type, due_date, due_time, start_at, end_at, status, note, created_at')
          .eq('customer_id', customerId).in('type', ['book_appointment', 'visit_customer']).order('created_at', { ascending: true }).limit(ITEM_LIMIT),
        db.from('customer_intake_tokens').select('id, created_at, submitted_at')
          .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(ITEM_LIMIT),
        db.from('customer_upload_sessions').select('id, file_count, uploaded_at')
          .eq('customer_id', customerId).order('uploaded_at', { ascending: true }).limit(ITEM_LIMIT),
      ]);

    // -- communications (calls + outbound/inbound messages) -------------------
    const comms = ((rawCommsRes.data ?? []) as unknown[]) as Array<{
      id: string; channel: string; direction: string; status: string; summary: string | null; created_at: string;
    }>;

    // -- call_briefs: pick the best brief per communication (transcript wins) --
    const rawBriefs = rawBriefsRes.data;
    const briefByComm = new Map<string, { kind: string; text: string }>();
    for (const b of ((rawBriefs ?? []) as unknown[]) as Array<{ communication_id: string | null; brief_kind: string; brief_text: string }>) {
      if (!b.communication_id) continue;
      const prev = briefByComm.get(b.communication_id);
      if (!prev || b.brief_kind === 'transcript') {
        briefByComm.set(b.communication_id, { kind: b.brief_kind, text: b.brief_text });
      }
    }

    for (const c of comms) {
      const inbound = c.direction === 'inbound';
      const brief = briefByComm.get(c.id);
      if (c.channel === 'call') {
        const missed = c.status === 'missed' || c.status === 'failed';
        items.push({
          id: `call:${c.id}`,
          type: 'call',
          side: inbound ? 'customer' : 'us',
          interactive: false,
          title: missed ? 'Αναπάντητη κλήση' : inbound ? 'Εισερχόμενη κλήση' : 'Εξερχόμενη κλήση',
          body: brief?.text ?? c.summary ?? null,
          status: c.status,
          occurredAt: c.created_at,
          refTable: 'communications',
          refId: c.id,
          payload: { hasBrief: Boolean(brief), briefKind: brief?.kind ?? null },
        });
      } else {
        items.push({
          id: `msg:${c.id}`,
          type: (c.channel as ItemType),
          side: inbound ? 'customer' : 'us',
          interactive: false,
          title: c.channel === 'sms' ? 'SMS' : c.channel === 'viber' ? 'Viber' : 'Email',
          body: c.summary ?? null,
          status: c.status,
          occurredAt: c.created_at,
          refTable: 'communications',
          refId: c.id,
        });
      }
    }

    // -- offers (our side) -----------------------------------------------------
    const offers = ((rawOffersRes.data ?? []) as unknown[]) as Array<{
      id: string; offer_number: string | null; status: string; total: number | null; offer_date: string | null; created_at: string;
    }>;
    const offerIds: string[] = [];
    for (const o of offers) {
      offerIds.push(o.id);
      const total = typeof o.total === 'number' ? `€${o.total.toLocaleString('el-GR')}` : null;
      items.push({
        id: `offer:${o.id}`,
        type: 'offer',
        side: 'us',
        interactive: false,
        title: o.offer_number ? `Προσφορά ${o.offer_number}` : 'Προσφορά',
        body: total,
        status: o.status,
        occurredAt: o.created_at,
        refTable: 'offers',
        refId: o.id,
      });
    }

    // -- appointment tasks (our side) -----------------------------------------
    const tasks = ((rawTasksRes.data ?? []) as unknown[]) as Array<{
      id: string; title: string | null; type: string; due_date: string | null; due_time: string | null;
      start_at: string | null; end_at: string | null; status: string; note: string | null; created_at: string;
    }>;
    const taskIds: string[] = [];
    for (const t of tasks) {
      taskIds.push(t.id);
      const whenDate = t.start_at ? fmtDateGr(t.start_at) : fmtDateGr(t.due_date);
      const whenTime = t.start_at
        ? new Date(t.start_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })
        : (t.due_time ?? '');
      const when = [whenDate, whenTime].filter(Boolean).join(' ');
      items.push({
        id: `appt:${t.id}`,
        type: 'appointment',
        side: 'us',
        interactive: false,
        title: when ? `Ραντεβού — ${when}` : 'Ραντεβού',
        body: t.note ?? t.title ?? null,
        status: t.status,
        occurredAt: t.created_at,
        refTable: 'tasks',
        refId: t.id,
        payload: { startAt: t.start_at, endAt: t.end_at, dueDate: t.due_date, dueTime: t.due_time },
      });
    }

    // -- stage 2: customer responses (offer + appointment), in parallel --------
    const [offerTokRes, apptTokRes] = await Promise.all([
      offerIds.length > 0
        ? db.from('offer_response_tokens').select('id, offer_id, response, responded_at')
            .in('offer_id', offerIds).not('responded_at', 'is', null).limit(ITEM_LIMIT)
        : Promise.resolve({ data: [] as unknown[] }),
      taskIds.length > 0
        ? db.from('appointment_response_tokens').select('id, task_id, response, responded_at, requested_due_date, requested_due_time')
            .in('task_id', taskIds).not('responded_at', 'is', null).limit(ITEM_LIMIT)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

    // -- offer responses (customer side, interactive) ---------------------------
    for (const t of ((offerTokRes.data ?? []) as unknown[]) as Array<{ id: string; offer_id: string; response: string | null; responded_at: string }>) {
      const accepted = t.response === 'accepted';
      const rejected = t.response === 'rejected';
      items.push({
        id: `offerresp:${t.id}`,
        type: 'offer_response',
        side: 'customer',
        interactive: true,
        title: accepted ? 'Αποδοχή προσφοράς' : rejected ? 'Απόρριψη προσφοράς' : 'Απάντηση σε προσφορά',
        body: null,
        status: t.response,
        occurredAt: t.responded_at,
        refTable: 'offers',
        refId: t.offer_id,
      });
    }

    // -- appointment responses (customer side, interactive) --------------------
    {
      for (const t of ((apptTokRes.data ?? []) as unknown[]) as Array<{
        id: string; task_id: string; response: string | null; responded_at: string; requested_due_date: string | null; requested_due_time: string | null;
      }>) {
        let title = 'Απάντηση σε ραντεβού';
        let body: string | null = null;
        if (t.response === 'accepted') title = 'Αποδοχή ραντεβού';
        else if (t.response === 'declined') title = 'Απόρριψη ραντεβού';
        else if (t.response === 'time_change_requested') {
          title = 'Αίτημα αλλαγής ώρας';
          const d = t.requested_due_date ? fmtDateGr(t.requested_due_date) : '';
          body = [d, t.requested_due_time ?? ''].filter(Boolean).join(' ') || null;
        }
        items.push({
          id: `apptresp:${t.id}`,
          type: 'appointment_response',
          side: 'customer',
          interactive: true,
          title,
          body,
          status: t.response,
          occurredAt: t.responded_at,
          refTable: 'tasks',
          refId: t.task_id,
        });
      }
    }

    // -- intake tokens (request = our side; submitted = customer side) ---------
    for (const t of ((rawIntakeRes.data ?? []) as unknown[]) as Array<{ id: string; created_at: string; submitted_at: string | null }>) {
      items.push({
        id: `intakereq:${t.id}`,
        type: 'intake_request',
        side: 'us',
        interactive: false,
        title: 'Αίτημα στοιχείων',
        body: null,
        status: t.submitted_at ? 'submitted' : 'sent',
        occurredAt: t.created_at,
        refTable: 'customer_intake_tokens',
        refId: t.id,
      });
      if (t.submitted_at) {
        items.push({
          id: `intakedone:${t.id}`,
          type: 'intake_submitted',
          side: 'customer',
          interactive: true,
          title: 'Ο πελάτης έστειλε τα στοιχεία του',
          body: null,
          status: 'submitted',
          occurredAt: t.submitted_at,
          refTable: 'customer_intake_tokens',
          refId: t.id,
        });
      }
    }

    // -- upload sessions (customer side, interactive) --------------------------
    for (const s of ((rawUploadsRes.data ?? []) as unknown[]) as Array<{ id: string; file_count: number | null; uploaded_at: string }>) {
      const n = typeof s.file_count === 'number' && s.file_count > 0 ? s.file_count : null;
      items.push({
        id: `upload:${s.id}`,
        type: 'upload',
        side: 'customer',
        interactive: true,
        title: 'Ο πελάτης ανέβασε αρχεία',
        body: n ? `${n} ${n === 1 ? 'αρχείο' : 'αρχεία'}` : 'Φωτογραφίες / αρχεία',
        status: 'uploaded',
        occurredAt: s.uploaded_at,
        refTable: 'customer_upload_sessions',
        refId: s.id,
      });
    }
  } catch {
    throw new AppError('timeline_query_failed', 500);
  }

  // -- invoices (our side) — ISOLATED + fault-tolerant -----------------------
  // The official-invoice add-on (AADE/myDATA) is optional and its `invoices`
  // table is created by migration 066, which is applied MANUALLY per tenant and
  // may not exist on a given environment. A missing table (or any provider error)
  // must NEVER break the rest of the timeline, so this lives outside the main
  // try/catch above and degrades to "no invoice items". Only `issued` invoices
  // (those with a real ΜΑΡΚ) are surfaced; drafts/failures stay internal.
  try {
    const { data } = await db
      .from('invoices')
      .select('id, invoice_type, series, aa, total_amount, status, mark, qr_url, issued_at, created_at')
      .eq('customer_id', customerId)
      .eq('status', 'issued')
      .order('created_at', { ascending: true })
      .limit(ITEM_LIMIT);
    for (const inv of ((data ?? []) as unknown[]) as Array<{
      id: string; invoice_type: string | null; series: string | null; aa: string | null;
      total_amount: number | null; status: string; mark: string | null; qr_url: string | null;
      issued_at: string | null; created_at: string;
    }>) {
      // 11.x = retail receipt (ΑΠΥ/ΑΛΠ, B2C); everything else is an invoice (B2B).
      const label = (inv.invoice_type ?? '').startsWith('11') ? 'Απόδειξη' : 'Τιμολόγιο';
      const num = [inv.series, inv.aa].filter(Boolean).join('');
      const total = typeof inv.total_amount === 'number'
        ? `€${inv.total_amount.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : null;
      items.push({
        id: `invoice:${inv.id}`,
        type: 'invoice',
        side: 'us',
        interactive: false,
        title: num ? `${label} ${num}` : label,
        body: total,
        status: inv.status,
        occurredAt: inv.issued_at ?? inv.created_at,
        refTable: 'invoices',
        refId: inv.id,
        payload: {
          mark: inv.mark,
          qrUrl: inv.qr_url,
          totalAmount: inv.total_amount,
          invoiceType: inv.invoice_type,
        },
      });
    }
  } catch {
    // invoicing not provisioned (table missing) or transient error → no invoice items
  }

  // Sort oldest → newest (chat order); cap.
  items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const trimmed = items.slice(-ITEM_LIMIT);

  const cust = customer as unknown as { id: string; name: string | null; company_name: string | null; crm_number: string | null };
  return {
    customer: { id: cust.id, name: cust.name ?? cust.company_name ?? cust.crm_number ?? 'Πελάτης' },
    items: trimmed,
  };
}
