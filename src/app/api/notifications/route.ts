// Notifications endpoint: returns recent customer-driven events for the
// authenticated business user. No provider sends. Read-only aggregation over
// offer_response_tokens, appointment_response_tokens, customer_intake_tokens,
// customer_upload_sessions (joined to customer_upload_tokens), and communications.
//
// Every query is explicitly scoped by business_id because the service-role
// client bypasses RLS. Never relax that filter.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Recency window for the coverage-expansion kinds (intake / upload / call / sms).
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_WINDOW_ISO = () => new Date(Date.now() - RECENT_WINDOW_MS).toISOString();

// Total cap across all merged kinds.
const TOTAL_LIMIT = 40;

function isWithin24h(eventAt: string): boolean {
  try {
    const ms = Date.now() - new Date(eventAt).getTime();
    return ms >= 0 && ms < 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

// date string from DB is either YYYY-MM-DD or starts with YYYY-MM-DD
function formatDateGr(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    const ymd = dateStr.split('T')[0].split('-');
    if (ymd.length !== 3) return dateStr;
    return `${ymd[2]}/${ymd[1]}/${ymd[0]}`;
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// DB row types (minimal columns needed)
// ---------------------------------------------------------------------------

interface OfferTokenRow {
  id: string;
  offer_id: string;
  response: string | null;
  responded_at: string;
}

interface ApptTokenRow {
  id: string;
  task_id: string;
  response: string | null;
  responded_at: string;
  requested_due_date: string | null;
  requested_due_time: string | null;
}

interface OfferRow {
  id: string;
  offer_number: string | null;
  customer_id: string | null;
}

interface TaskRow {
  id: string;
  title: string | null;
  customer_id: string | null;
}

interface CustomerRow {
  id: string;
  name: string | null;
  company_name: string | null;
  crm_number: string | null;
}

interface IntakeTokenRow {
  id: string;
  customer_id: string | null;
  submitted_at: string | null;
}

interface UploadSessionRow {
  id: string;
  customer_id: string | null;
  upload_token_id: string | null;
  file_count: number | null;
  uploaded_at: string;
}

interface UploadTokenRow {
  id: string;
  sent_channel: string | null;
}

interface CommunicationRow {
  id: string;
  customer_id: string | null;
  channel: string;
  direction: string;
  status: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

type NotificationKind =
  | 'offer'
  | 'appointment'
  | 'intake'
  | 'upload'
  | 'call'
  | 'sms';

interface Notification {
  id: string;
  kind: NotificationKind;
  response: string;
  title: string;
  description: string;
  customerId: string | null;
  customerName: string;
  href: string;
  // Canonical event timestamp for sorting / seen logic. For backward
  // compatibility respondedAt mirrors eventAt for every kind.
  eventAt: string;
  respondedAt: string;
  isNew: boolean;
  taskId: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
}

function customerDisplayName(c: CustomerRow | undefined): string {
  return c?.name ?? c?.company_name ?? c?.crm_number ?? 'Πελάτης';
}

function customerHref(customerId: string | null, fallback: string): string {
  return customerId ? `/customers/${customerId}` : fallback;
}

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) {
    // No business yet: return empty list rather than 404 to avoid breaking the bell.
    if (auth.error.status === 404) {
      return NextResponse.json({ ok: true, notifications: [] });
    }
    return auth.error;
  }
  const { supabase, businessId } = auth.ctx;

  try {
    const recentSince = RECENT_WINDOW_ISO();

    // -------------------------------------------------------------------------
    // 1. Offer response tokens
    // -------------------------------------------------------------------------
    const { data: rawOfferTokens, error: offerTokenErr } = await supabase
      .from('offer_response_tokens')
      .select('id, offer_id, response, responded_at')
      .eq('business_id', businessId)
      .not('responded_at', 'is', null)
      .order('responded_at', { ascending: false })
      .limit(30);

    if (offerTokenErr) {
      return NextResponse.json({ ok: false, error: 'notifications_query_failed' }, { status: 500 });
    }

    const offerTokens = ((rawOfferTokens ?? []) as unknown[]) as OfferTokenRow[];

    // -------------------------------------------------------------------------
    // 2. Offer metadata (offer_number, customer_id)
    // -------------------------------------------------------------------------
    const offerIds = [...new Set(offerTokens.map((t) => t.offer_id).filter(Boolean))];
    const offersById = new Map<string, OfferRow>();

    if (offerIds.length > 0) {
      const { data: rawOffers } = await supabase
        .from('offers')
        .select('id, offer_number, customer_id')
        .eq('business_id', businessId)
        .in('id', offerIds);

      for (const row of ((rawOffers ?? []) as unknown[]) as OfferRow[]) {
        offersById.set(row.id, row);
      }
    }

    // -------------------------------------------------------------------------
    // 3. Appointment response tokens
    // -------------------------------------------------------------------------
    const { data: rawApptTokens, error: apptTokenErr } = await supabase
      .from('appointment_response_tokens')
      .select('id, task_id, response, responded_at, requested_due_date, requested_due_time')
      .eq('business_id', businessId)
      .not('responded_at', 'is', null)
      .order('responded_at', { ascending: false })
      .limit(30);

    if (apptTokenErr) {
      return NextResponse.json({ ok: false, error: 'notifications_query_failed' }, { status: 500 });
    }

    const apptTokens = ((rawApptTokens ?? []) as unknown[]) as ApptTokenRow[];

    // -------------------------------------------------------------------------
    // 4. Task metadata (title, customer_id)
    // -------------------------------------------------------------------------
    const taskIds = [...new Set(apptTokens.map((t) => t.task_id).filter(Boolean))];
    const tasksById = new Map<string, TaskRow>();

    if (taskIds.length > 0) {
      const { data: rawTasks } = await supabase
        .from('tasks')
        .select('id, title, customer_id')
        .eq('business_id', businessId)
        .in('id', taskIds);

      for (const row of ((rawTasks ?? []) as unknown[]) as TaskRow[]) {
        tasksById.set(row.id, row);
      }
    }

    // -------------------------------------------------------------------------
    // 5. Intake submissions (customer sent their info)
    // -------------------------------------------------------------------------
    const { data: rawIntakeTokens } = await supabase
      .from('customer_intake_tokens')
      .select('id, customer_id, submitted_at')
      .eq('business_id', businessId)
      .not('submitted_at', 'is', null)
      .gte('submitted_at', recentSince)
      .order('submitted_at', { ascending: false })
      .limit(30);

    const intakeTokens = ((rawIntakeTokens ?? []) as unknown[]) as IntakeTokenRow[];

    // -------------------------------------------------------------------------
    // 6. Customer uploads (only customer-originated, NOT business-side manual)
    // -------------------------------------------------------------------------
    const { data: rawUploadSessions } = await supabase
      .from('customer_upload_sessions')
      .select('id, customer_id, upload_token_id, file_count, uploaded_at')
      .eq('business_id', businessId)
      .gte('uploaded_at', recentSince)
      .order('uploaded_at', { ascending: false })
      .limit(30);

    const uploadSessions = ((rawUploadSessions ?? []) as unknown[]) as UploadSessionRow[];

    // Resolve the originating token's channel so we can exclude business-side
    // manual uploads (sent_channel === 'manual'). Only sessions whose token was
    // sent to the customer (viber/sms) count as customer-originated.
    const uploadTokenIds = [
      ...new Set(uploadSessions.map((s) => s.upload_token_id).filter((v): v is string => !!v)),
    ];
    const uploadTokensById = new Map<string, UploadTokenRow>();

    if (uploadTokenIds.length > 0) {
      const { data: rawUploadTokens } = await supabase
        .from('customer_upload_tokens')
        .select('id, sent_channel')
        .eq('business_id', businessId)
        .in('id', uploadTokenIds);

      for (const row of ((rawUploadTokens ?? []) as unknown[]) as UploadTokenRow[]) {
        uploadTokensById.set(row.id, row);
      }
    }

    // Keep only customer-originated uploads: the token must exist and its
    // sent_channel must not be 'manual'.
    const customerUploadSessions = uploadSessions.filter((s) => {
      if (!s.upload_token_id) return false;
      const tok = uploadTokensById.get(s.upload_token_id);
      if (!tok) return false;
      return tok.sent_channel !== 'manual';
    });

    // -------------------------------------------------------------------------
    // 7. Inbound communications (calls + SMS) within the window
    // -------------------------------------------------------------------------
    const { data: rawComms } = await supabase
      .from('communications')
      .select('id, customer_id, channel, direction, status, created_at')
      .eq('business_id', businessId)
      .eq('direction', 'inbound')
      .in('channel', ['call', 'sms'])
      .gte('created_at', recentSince)
      .order('created_at', { ascending: false })
      .limit(30);

    const comms = ((rawComms ?? []) as unknown[]) as CommunicationRow[];

    // -------------------------------------------------------------------------
    // 8. Customer names for all referenced customers (single batched lookup)
    // -------------------------------------------------------------------------
    const allCustomerIds = new Set<string>();
    for (const offer of offersById.values()) {
      if (offer.customer_id) allCustomerIds.add(offer.customer_id);
    }
    for (const task of tasksById.values()) {
      if (task.customer_id) allCustomerIds.add(task.customer_id);
    }
    for (const tok of intakeTokens) {
      if (tok.customer_id) allCustomerIds.add(tok.customer_id);
    }
    for (const s of customerUploadSessions) {
      if (s.customer_id) allCustomerIds.add(s.customer_id);
    }
    for (const c of comms) {
      if (c.customer_id) allCustomerIds.add(c.customer_id);
    }

    const customersById = new Map<string, CustomerRow>();
    const customerIdList = [...allCustomerIds];

    if (customerIdList.length > 0) {
      const { data: rawCustomers } = await supabase
        .from('customers')
        .select('id, name, company_name, crm_number')
        .eq('business_id', businessId)
        .in('id', customerIdList);

      for (const row of ((rawCustomers ?? []) as unknown[]) as CustomerRow[]) {
        customersById.set(row.id, row);
      }
    }

    const nameFor = (customerId: string | null): string =>
      customerDisplayName(customerId ? customersById.get(customerId) : undefined);

    // -------------------------------------------------------------------------
    // 9. Build offer notifications
    // -------------------------------------------------------------------------
    const offerNotifs: Notification[] = offerTokens.map((tok) => {
      const offer = offersById.get(tok.offer_id);
      const customerId = offer?.customer_id ?? null;
      const name = nameFor(customerId);
      const offerNum = offer?.offer_number ?? '';
      const response = tok.response ?? '';

      let title: string;
      let description: string;

      if (response === 'accepted') {
        title = 'Αποδοχή προσφοράς';
        description = offerNum
          ? `Ο πελάτης ${name} αποδέχτηκε την προσφορά ${offerNum}.`
          : `Ο πελάτης ${name} αποδέχτηκε την προσφορά.`;
      } else if (response === 'rejected') {
        title = 'Απόρριψη προσφοράς';
        description = offerNum
          ? `Ο πελάτης ${name} απέρριψε την προσφορά ${offerNum}.`
          : `Ο πελάτης ${name} απέρριψε την προσφορά.`;
      } else {
        title = 'Απάντηση σε προσφορά';
        description = `Ο πελάτης ${name} απάντησε σε προσφορά.`;
      }

      return {
        id: tok.id,
        kind: 'offer',
        response,
        title,
        description,
        customerId,
        customerName: name,
        href: customerHref(customerId, '/offers'),
        eventAt: tok.responded_at,
        respondedAt: tok.responded_at,
        isNew: isWithin24h(tok.responded_at),
        taskId: null,
        requestedDueDate: null,
        requestedDueTime: null,
      };
    });

    // -------------------------------------------------------------------------
    // 10. Build appointment notifications
    // -------------------------------------------------------------------------
    const apptNotifs: Notification[] = apptTokens.map((tok) => {
      const task = tasksById.get(tok.task_id);
      const customerId = task?.customer_id ?? null;
      const name = nameFor(customerId);
      const response = tok.response ?? '';

      let title: string;
      let description: string;

      if (response === 'accepted') {
        title = 'Αποδοχή ραντεβού';
        description = `Ο πελάτης ${name} αποδέχτηκε το ραντεβού.`;
      } else if (response === 'declined') {
        title = 'Απόρριψη ραντεβού';
        description = `Ο πελάτης ${name} απέρριψε το ραντεβού.`;
      } else if (response === 'time_change_requested') {
        title = 'Αίτημα αλλαγής ώρας';
        const dateStr = tok.requested_due_date ? formatDateGr(tok.requested_due_date) : null;
        const timeStr = tok.requested_due_time ?? null;
        if (dateStr && timeStr) {
          description = `Ο πελάτης ${name} ζήτησε αλλαγή ώρας για ${dateStr} στις ${timeStr}.`;
        } else if (dateStr) {
          description = `Ο πελάτης ${name} ζήτησε αλλαγή ώρας για ${dateStr}.`;
        } else {
          description = `Ο πελάτης ${name} ζήτησε αλλαγή ώρας.`;
        }
      } else {
        title = 'Απάντηση σε ραντεβού';
        description = `Ο πελάτης ${name} απάντησε σε ραντεβού.`;
      }

      return {
        id: tok.id,
        kind: 'appointment',
        response,
        title,
        description,
        customerId,
        customerName: name,
        href: customerHref(customerId, '/tasks'),
        eventAt: tok.responded_at,
        respondedAt: tok.responded_at,
        isNew: isWithin24h(tok.responded_at),
        taskId: tok.task_id,
        requestedDueDate: tok.requested_due_date,
        requestedDueTime: tok.requested_due_time,
      };
    });

    // -------------------------------------------------------------------------
    // 11. Build intake-submitted notifications
    // -------------------------------------------------------------------------
    const intakeNotifs: Notification[] = intakeTokens
      .filter((tok) => !!tok.submitted_at)
      .map((tok) => {
        const customerId = tok.customer_id ?? null;
        const name = nameFor(customerId);
        const eventAt = tok.submitted_at as string;
        return {
          id: `intake:${tok.id}`,
          kind: 'intake',
          response: 'submitted',
          title: 'Ο πελάτης έστειλε στοιχεία',
          description: `Ο πελάτης ${name} συμπλήρωσε και έστειλε τα στοιχεία του.`,
          customerId,
          customerName: name,
          href: customerHref(customerId, '/customers'),
          eventAt,
          respondedAt: eventAt,
          isNew: isWithin24h(eventAt),
          taskId: null,
          requestedDueDate: null,
          requestedDueTime: null,
        };
      });

    // -------------------------------------------------------------------------
    // 12. Build customer-upload notifications
    // -------------------------------------------------------------------------
    const uploadNotifs: Notification[] = customerUploadSessions.map((s) => {
      const customerId = s.customer_id ?? null;
      const name = nameFor(customerId);
      const count = typeof s.file_count === 'number' && s.file_count > 0 ? s.file_count : null;
      const description = count
        ? `Ο πελάτης ${name} ανέβασε ${count} ${count === 1 ? 'αρχείο' : 'αρχεία'}.`
        : `Ο πελάτης ${name} ανέβασε φωτογραφίες/αρχεία.`;
      return {
        id: `upload:${s.id}`,
        kind: 'upload',
        response: 'uploaded',
        title: 'Ο πελάτης ανέβασε φωτογραφίες/αρχεία',
        description,
        customerId,
        customerName: name,
        href: customerHref(customerId, '/customers'),
        eventAt: s.uploaded_at,
        respondedAt: s.uploaded_at,
        isNew: isWithin24h(s.uploaded_at),
        taskId: null,
        requestedDueDate: null,
        requestedDueTime: null,
      };
    });

    // -------------------------------------------------------------------------
    // 13. Build inbound communication notifications (call / sms)
    // -------------------------------------------------------------------------
    const commNotifs: Notification[] = comms.map((c) => {
      const customerId = c.customer_id ?? null;
      const name = nameFor(customerId);
      const isMissed = c.status === 'missed' || c.status === 'failed';

      let kind: NotificationKind;
      let title: string;
      let description: string;
      let href: string;

      if (c.channel === 'sms') {
        kind = 'sms';
        title = 'Εισερχόμενο SMS';
        description = `Ο πελάτης ${name} έστειλε SMS.`;
        href = customerHref(customerId, '/communications');
      } else {
        kind = 'call';
        if (isMissed) {
          title = 'Χαμένη κλήση';
          description = `Χαμένη κλήση από ${name}.`;
        } else {
          title = 'Εισερχόμενη κλήση';
          description = `Εισερχόμενη κλήση από ${name}.`;
        }
        href = customerHref(customerId, '/calls');
      }

      return {
        id: `comm:${c.id}`,
        kind,
        response: c.status,
        title,
        description,
        customerId,
        customerName: name,
        href,
        eventAt: c.created_at,
        respondedAt: c.created_at,
        isNew: isWithin24h(c.created_at),
        taskId: null,
        requestedDueDate: null,
        requestedDueTime: null,
      };
    });

    // -------------------------------------------------------------------------
    // 14. Merge ALL kinds, sort newest-first by event time, cap.
    // -------------------------------------------------------------------------
    const all: Notification[] = [
      ...offerNotifs,
      ...apptNotifs,
      ...intakeNotifs,
      ...uploadNotifs,
      ...commNotifs,
    ]
      .sort((a, b) => b.eventAt.localeCompare(a.eventAt))
      .slice(0, TOTAL_LIMIT);

    return NextResponse.json({ ok: true, notifications: all });
  } catch {
    return NextResponse.json({ ok: false, error: 'notifications_query_failed' }, { status: 500 });
  }
}
