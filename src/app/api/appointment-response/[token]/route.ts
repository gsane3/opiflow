// Public appointment-response API. No authenticated Bearer is required.
// The raw public token is the sole credential -- it is hashed before any DB lookup.
// Service-role Supabase client is used for all DB operations.
// Raw DB error messages are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidAppointmentResponseToken,
  markAppointmentResponseTokenOpened,
  markAppointmentResponseTokenResponded,
} from '@/lib/server/appointment-response-tokens';
import type { AppointmentResponseTokenRow } from '@/lib/server/appointment-response-tokens';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Column lists
// ---------------------------------------------------------------------------

const TASK_COLUMNS = [
  'id', 'business_id', 'customer_id', 'offer_id',
  'title', 'type', 'status', 'priority',
  'due_date', 'due_time', 'note',
  'updated_at',
].join(', ');

const BUSINESS_COLUMNS = [
  'name', 'phone', 'email', 'address', 'logo_url',
].join(', ');

const CUSTOMER_COLUMNS = [
  'name', 'company_name', 'email', 'address',
].join(', ');

const OFFER_COLUMNS = [
  'offer_number', 'status', 'total',
].join(', ');

// ---------------------------------------------------------------------------
// Row interfaces
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  offer_id: string | null;
  title: string;
  type: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  due_time: string | null;
  note: string | null;
  updated_at: string;
}

interface BusinessRow {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
}

interface CustomerRow {
  name: string;
  company_name: string | null;
  email: string | null;
  address: string | null;
}

interface OfferRow {
  offer_number: string;
  status: string;
  total: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPOINTMENT_TYPES = ['book_appointment', 'visit_customer'] as const;
const FINAL_TASK_STATUSES = ['completed', 'cancelled'] as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isBeforeToday(dateStr: string): boolean {
  return dateStr < new Date().toISOString().split('T')[0];
}

function computeCanRespond(task: TaskRow): boolean {
  if ((FINAL_TASK_STATUSES as readonly string[]).includes(task.status)) return false;
  if (!(APPOINTMENT_TYPES as readonly string[]).includes(task.type)) return false;
  if (!task.due_date) return false;
  if (isBeforeToday(task.due_date)) return false;
  return true;
}

function mapBusiness(row: BusinessRow) {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    logoUrl: row.logo_url,
  };
}

function mapCustomer(row: CustomerRow) {
  return {
    name: row.name,
    companyName: row.company_name,
    email: row.email,
    address: row.address,
  };
}

function mapOffer(row: OfferRow) {
  return {
    offerNumber: row.offer_number,
    status: row.status,
    total: row.total,
  };
}

function mapAppointmentForPublic(task: TaskRow) {
  return {
    title: task.title,
    type: task.type,
    status: task.status,
    priority: task.priority,
    dueDate: task.due_date,
    dueTime: task.due_time,
    note: task.note,
  };
}

function buildNoteAppend(
  response: 'accepted' | 'declined' | 'time_change_requested',
  isoDate: string,
  requestedDueDate: string | null,
  requestedDueTime: string | null,
  comment: string | null
): string {
  let line: string;
  if (response === 'accepted') {
    line = `Απάντηση μέσω δημόσιου link: Αποδοχή ραντεβού στις ${isoDate}.`;
  } else if (response === 'declined') {
    line = `Απάντηση μέσω δημόσιου link: Αδυναμία παρουσίας στις ${isoDate}.`;
  } else {
    line = `Απάντηση μέσω δημόσιου link: Αίτημα αλλαγής ώρας στις ${isoDate}.`;
  }

  if (requestedDueDate || requestedDueTime) {
    const parts = [requestedDueDate, requestedDueTime].filter(Boolean).join(' ');
    line += ` Νέα πρόταση: ${parts}.`;
  }

  if (comment) {
    line += ` Σχόλιο: ${comment}`;
  }

  return line;
}

function buildCommunicationSummary(
  response: 'accepted' | 'declined' | 'time_change_requested',
  dueDate: string | null,
  dueTime: string | null,
  requestedDueDate: string | null,
  requestedDueTime: string | null,
  comment: string | null
): string {
  const when = [dueDate, dueTime].filter(Boolean).join(' ');

  let base: string;
  if (response === 'accepted') {
    base = `Ο πελάτης αποδέχτηκε το ραντεβού ${when} μέσω δημόσιου link.`;
  } else if (response === 'declined') {
    base = `Ο πελάτης δήλωσε ότι δεν μπορεί για το ραντεβού ${when} μέσω δημόσιου link.`;
  } else {
    base = `Ο πελάτης ζήτησε αλλαγή ώρας για το ραντεβού ${when} μέσω δημόσιου link.`;
  }

  if (requestedDueDate || requestedDueTime) {
    const parts = [requestedDueDate, requestedDueTime].filter(Boolean).join(' ');
    base += ` Νέα πρόταση: ${parts}.`;
  }

  if (comment) {
    base += ` Σχόλιο: ${comment}`;
  }

  return base;
}

function resolveChannel(sentChannel: AppointmentResponseTokenRow['sent_channel']): string {
  if (sentChannel === 'viber' || sentChannel === 'sms' || sentChannel === 'email') {
    return sentChannel;
  }
  return 'sms';
}

// ---------------------------------------------------------------------------
// GET /api/appointment-response/[token]
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;

  // Validate token (hashes internally, queries DB with service_role)
  let tokenRow: AppointmentResponseTokenRow | null;
  try {
    tokenRow = await findValidAppointmentResponseToken(rawToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_load_failed' },
      { status: 500 }
    );
  }

  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_link_invalid_or_expired' },
      { status: 404 }
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_load_failed' },
      { status: 500 }
    );
  }

  try {
    // Fetch task
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('id', tokenRow.task_id)
      .eq('business_id', tokenRow.business_id)
      .maybeSingle();

    if (taskError) {
      return NextResponse.json(
        { ok: false, error: 'appointment_response_load_failed' },
        { status: 500 }
      );
    }

    const task = taskData as unknown as TaskRow | null;

    if (!task || !(APPOINTMENT_TYPES as readonly string[]).includes(task.type)) {
      return NextResponse.json(
        { ok: false, error: 'appointment_not_found' },
        { status: 404 }
      );
    }

    // Fetch business
    const { data: bizData, error: bizError } = await supabase
      .from('businesses')
      .select(BUSINESS_COLUMNS)
      .eq('id', tokenRow.business_id)
      .maybeSingle();

    if (bizError) {
      return NextResponse.json(
        { ok: false, error: 'appointment_response_load_failed' },
        { status: 500 }
      );
    }
    const business = bizData ? mapBusiness(bizData as unknown as BusinessRow) : null;

    // Fetch customer only when task has a customer_id (business_id filter enforces tenancy)
    let customer: ReturnType<typeof mapCustomer> | null = null;
    if (task.customer_id) {
      const { data: custData, error: custError } = await supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .eq('id', task.customer_id)
        .eq('business_id', tokenRow.business_id)
        .maybeSingle();

      if (custError) {
        return NextResponse.json(
          { ok: false, error: 'appointment_response_load_failed' },
          { status: 500 }
        );
      }
      if (custData) {
        customer = mapCustomer(custData as unknown as CustomerRow);
      }
    }

    // Fetch offer only when task has an offer_id (business_id filter enforces tenancy)
    let offer: ReturnType<typeof mapOffer> | null = null;
    if (task.offer_id) {
      const { data: offerData, error: offerError } = await supabase
        .from('offers')
        .select(OFFER_COLUMNS)
        .eq('id', task.offer_id)
        .eq('business_id', tokenRow.business_id)
        .maybeSingle();

      if (offerError) {
        return NextResponse.json(
          { ok: false, error: 'appointment_response_load_failed' },
          { status: 500 }
        );
      }
      if (offerData) {
        offer = mapOffer(offerData as unknown as OfferRow);
      }
    }

    // Mark token opened (best-effort: no-ops when already opened/responded)
    try {
      await markAppointmentResponseTokenOpened(tokenRow.id);
    } catch {
      // Intentionally swallowed -- opened tracking must not block the public page load.
    }

    return NextResponse.json({
      ok: true,
      tokenStatus: tokenRow.status,
      appointment: mapAppointmentForPublic(task),
      business,
      customer,
      offer,
      canRespond: computeCanRespond(task),
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_load_failed' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/appointment-response/[token]
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Content-type guard
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const { token: rawToken } = await params;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  // Accept `response` or `action` key
  const responseRaw = raw.response ?? raw.action;
  if (
    responseRaw !== 'accepted' &&
    responseRaw !== 'declined' &&
    responseRaw !== 'time_change_requested'
  ) {
    return NextResponse.json({ ok: false, error: 'invalid_response' }, { status: 400 });
  }
  const response = responseRaw as 'accepted' | 'declined' | 'time_change_requested';

  // Extract and sanitize comment
  let comment: string | null = null;
  if (typeof raw.comment === 'string') {
    const trimmed = raw.comment.trim();
    if (trimmed.length > 0) {
      comment = trimmed.length > 1000 ? trimmed.slice(0, 1000) : trimmed;
    }
  }

  // Validate requestedDueDate
  let requestedDueDate: string | null = null;
  if (raw.requestedDueDate !== undefined && raw.requestedDueDate !== null) {
    if (typeof raw.requestedDueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.requestedDueDate)) {
      return NextResponse.json(
        { ok: false, error: 'invalid_requested_due_date' },
        { status: 400 }
      );
    }
    requestedDueDate = raw.requestedDueDate;
  }

  // Validate requestedDueTime
  let requestedDueTime: string | null = null;
  if (raw.requestedDueTime !== undefined && raw.requestedDueTime !== null) {
    if (
      typeof raw.requestedDueTime !== 'string' ||
      !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(raw.requestedDueTime)
    ) {
      return NextResponse.json(
        { ok: false, error: 'invalid_requested_due_time' },
        { status: 400 }
      );
    }
    requestedDueTime = raw.requestedDueTime;
  }

  // Validate token
  let tokenRow: AppointmentResponseTokenRow | null;
  try {
    tokenRow = await findValidAppointmentResponseToken(rawToken);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_load_failed' },
      { status: 500 }
    );
  }

  if (!tokenRow) {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_link_invalid_or_expired' },
      { status: 404 }
    );
  }

  let supabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    supabase = createServiceSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_load_failed' },
      { status: 500 }
    );
  }

  // Fetch task
  let task: TaskRow;
  try {
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('id', tokenRow.task_id)
      .eq('business_id', tokenRow.business_id)
      .maybeSingle();

    if (taskError) {
      return NextResponse.json(
        { ok: false, error: 'appointment_response_load_failed' },
        { status: 500 }
      );
    }

    const maybeTask = taskData as unknown as TaskRow | null;

    if (!maybeTask || !(APPOINTMENT_TYPES as readonly string[]).includes(maybeTask.type)) {
      return NextResponse.json(
        { ok: false, error: 'appointment_not_found' },
        { status: 404 }
      );
    }

    task = maybeTask;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_load_failed' },
      { status: 500 }
    );
  }

  // Guard: already in a final state
  if ((FINAL_TASK_STATUSES as readonly string[]).includes(task.status)) {
    return NextResponse.json(
      { ok: false, error: 'appointment_already_final' },
      { status: 409 }
    );
  }

  // Guard: due_date passed
  if (task.due_date && isBeforeToday(task.due_date)) {
    return NextResponse.json(
      { ok: false, error: 'appointment_expired' },
      { status: 409 }
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const isoDate = nowIso.split('T')[0];

  // Build updated note (preserve existing note, append tracking line)
  const noteAppend = buildNoteAppend(response, isoDate, requestedDueDate, requestedDueTime, comment);
  const updatedNote = task.note
    ? `${task.note}\n\n${noteAppend}`
    : noteAppend;

  // Update task note and updated_at only
  try {
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        note: updatedNote,
        updated_at: nowIso,
      })
      .eq('id', task.id)
      .eq('business_id', tokenRow.business_id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: 'appointment_response_update_failed' },
        { status: 500 }
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_update_failed' },
      { status: 500 }
    );
  }

  // Insert communications row (CRM audit trail)
  const commSummary = buildCommunicationSummary(
    response,
    task.due_date,
    task.due_time,
    requestedDueDate,
    requestedDueTime,
    comment
  );
  const channel = resolveChannel(tokenRow.sent_channel);

  try {
    const { error: commError } = await supabase
      .from('communications')
      .insert({
        business_id: tokenRow.business_id,
        customer_id: task.customer_id,
        channel,
        direction: 'inbound',
        status: 'completed',
        phone: null,
        summary: commSummary,
      });

    if (commError) {
      return NextResponse.json(
        { ok: false, error: 'appointment_response_record_failed' },
        { status: 500 }
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_record_failed' },
      { status: 500 }
    );
  }

  // Mark token responded (status, response value, date/time, comment, timestamp)
  try {
    await markAppointmentResponseTokenResponded({
      tokenId: tokenRow.id,
      response,
      comment,
      requestedDueDate,
      requestedDueTime,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_record_failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    response,
    appointment: {
      title: task.title,
      status: task.status,
      dueDate: task.due_date,
      dueTime: task.due_time,
    },
  });
}
