// Notifications endpoint: returns recent offer and appointment responses for the
// authenticated business user. No provider sends. Read-only aggregation over
// offer_response_tokens and appointment_response_tokens.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWithin24h(respondedAt: string): boolean {
  try {
    const ms = Date.now() - new Date(respondedAt).getTime();
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

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

interface Notification {
  id: string;
  kind: 'offer' | 'appointment';
  response: string;
  title: string;
  description: string;
  customerId: string | null;
  customerName: string;
  href: string;
  respondedAt: string;
  isNew: boolean;
  taskId: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
}

function customerDisplayName(c: CustomerRow | undefined): string {
  return c?.name ?? c?.company_name ?? c?.crm_number ?? 'Πελάτης';
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
    // 5. Customer names for all referenced customers
    // -------------------------------------------------------------------------
    const allCustomerIds = new Set<string>();
    for (const offer of offersById.values()) {
      if (offer.customer_id) allCustomerIds.add(offer.customer_id);
    }
    for (const task of tasksById.values()) {
      if (task.customer_id) allCustomerIds.add(task.customer_id);
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

    // -------------------------------------------------------------------------
    // 6. Build offer notifications
    // -------------------------------------------------------------------------
    const offerNotifs: Notification[] = offerTokens.map((tok) => {
      const offer = offersById.get(tok.offer_id);
      const customerId = offer?.customer_id ?? null;
      const customer = customerId ? customersById.get(customerId) : undefined;
      const name = customerDisplayName(customer);
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
        href: customerId ? `/customers/${customerId}` : '/offers',
        respondedAt: tok.responded_at,
        isNew: isWithin24h(tok.responded_at),
        taskId: null,
        requestedDueDate: null,
        requestedDueTime: null,
      };
    });

    // -------------------------------------------------------------------------
    // 7. Build appointment notifications
    // -------------------------------------------------------------------------
    const apptNotifs: Notification[] = apptTokens.map((tok) => {
      const task = tasksById.get(tok.task_id);
      const customerId = task?.customer_id ?? null;
      const customer = customerId ? customersById.get(customerId) : undefined;
      const name = customerDisplayName(customer);
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
        href: customerId ? `/customers/${customerId}` : '/tasks',
        respondedAt: tok.responded_at,
        isNew: isWithin24h(tok.responded_at),
        taskId: tok.task_id,
        requestedDueDate: tok.requested_due_date,
        requestedDueTime: tok.requested_due_time,
      };
    });

    // -------------------------------------------------------------------------
    // 8. Merge, sort newest-first, cap at 20
    // -------------------------------------------------------------------------
    const all: Notification[] = [...offerNotifs, ...apptNotifs]
      .sort((a, b) => b.respondedAt.localeCompare(a.respondedAt))
      .slice(0, 20);

    return NextResponse.json({ ok: true, notifications: all });
  } catch {
    return NextResponse.json({ ok: false, error: 'notifications_query_failed' }, { status: 500 });
  }
}
