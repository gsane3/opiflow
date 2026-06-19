// Public appointment-response API. No authenticated Bearer is required.
// The raw public token is the sole credential -- it is hashed before any DB lookup.
// Service-role Supabase client is used for all DB operations.
// Raw DB error messages are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import {
  createServiceSupabaseClient,
  findValidAppointmentResponseToken,
  markAppointmentResponseTokenOpened,
} from '@/lib/server/appointment-response-tokens';
import type { AppointmentResponseTokenRow } from '@/lib/server/appointment-response-tokens';
import { applyAppointmentResponse } from '@/lib/server/appointment-respond';
import { APPOINTMENT_TYPES, appointmentCanRespond } from '@/lib/server/appointment-status';
import { makePublicLimiter } from '@/lib/api/rate-limit-guard';

export const runtime = 'nodejs';

// Public endpoint — rate-limit by IP to deter abuse/scraping.
const publicLimiter = makePublicLimiter(40, 60_000);

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
// Pure helpers — guards/canRespond/±60-min math + note/summary builders now live
// in '@/lib/server/appointment-status' + '@/lib/server/appointment-respond' so
// this route and the folder portal share one path. The map* helpers are GET-only.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GET /api/appointment-response/[token]
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = await publicLimiter(request);
  if (limited) return limited;

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
      canRespond: appointmentCanRespond(task),
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
  const limited = await publicLimiter(request);
  if (limited) return limited;

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

  // Apply the response via the shared lib (same path the folder portal uses).
  const result = await applyAppointmentResponse({
    supabase,
    businessId: tokenRow.business_id,
    task,
    response,
    comment,
    requestedDueDate,
    requestedDueTime,
    sentChannel: tokenRow.sent_channel,
    tokenId: tokenRow.id,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.httpStatus });
  }

  return NextResponse.json({
    ok: true,
    response,
    appointment: {
      title: result.title,
      status: result.status,
      dueDate: result.dueDate,
      dueTime: result.dueTime,
    },
  });
}
