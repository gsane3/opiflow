// CRM tasks list and create endpoints.
// Phase 3: serves the already-applied tasks table from 003_crm_core.sql.
// Business isolation is enforced via explicit business_id filter on every query
// (service_role bypasses RLS, so this filter is the sole isolation mechanism).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { resolveWorkFolderForCreate } from '@/lib/server/folder-link';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_COLUMNS = [
  'id', 'customer_id', 'offer_id', 'title', 'type', 'status', 'priority',
  'due_date', 'due_time', 'note', 'created_from_ai', 'completed_at',
  'created_at', 'updated_at',
].join(', ');

const VALID_TYPES = [
  'call_back', 'send_offer', 'follow_up_offer', 'ask_for_photos_documents',
  'book_appointment', 'visit_customer', 'wait_for_reply', 'other',
] as const;

// All readable statuses (ai_draft included for GET filter).
const VALID_STATUSES_READ = ['open', 'completed', 'cancelled', 'ai_draft'] as const;

// Statuses allowed for manual write via POST/PATCH (ai_draft excluded).
const VALID_STATUSES_WRITE = ['open', 'completed', 'cancelled'] as const;

const VALID_PRIORITIES = ['low', 'normal', 'high'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidEnum<T extends string>(
  value: unknown,
  validValues: readonly T[]
): value is T {
  return typeof value === 'string' && (validValues as readonly string[]).includes(value);
}

function isValidDueDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidDueTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
}

// ---------------------------------------------------------------------------
// DB row type and mapper
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  customer_id: string | null;
  offer_id: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  due_date: string;
  due_time: string | null;
  note: string | null;
  created_from_ai: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function dbToTask(row: TaskRow) {
  return {
    id: row.id,
    customerId: row.customer_id,
    offerId: row.offer_id,
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    dueTime: row.due_time,
    note: row.note,
    createdFromAi: row.created_from_ai,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Cast helper: routes Supabase's untyped query result through unknown to TaskRow.
// Required because .select(stringVar) returns GenericStringError without a DB schema type.
function asTaskRow(value: unknown): TaskRow {
  return value as TaskRow;
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

// ---------------------------------------------------------------------------
// Customer ownership validation
// ---------------------------------------------------------------------------

async function validateCustomerBelongsToBusiness(
  supabase: SupabaseClient,
  customerId: string,
  businessId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  return data !== null;
}

async function validateOfferBelongsToBusiness(
  supabase: SupabaseClient,
  offerId: string,
  businessId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('offers')
    .select('id')
    .eq('id', offerId)
    .eq('business_id', businessId)
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// GET /api/tasks
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { searchParams } = request.nextUrl;
    const statusParam = searchParams.get('status');
    const customerIdParam = searchParams.get('customerId');
    const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10);
    const offsetRaw = parseInt(searchParams.get('offset') ?? '0', 10);

    if (statusParam && !isValidEnum(statusParam, VALID_STATUSES_READ)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
    }

    const limit = Math.min(Math.max(isNaN(limitRaw) ? 50 : limitRaw, 1), 100);
    const offset = Math.max(isNaN(offsetRaw) ? 0 : offsetRaw, 0);

    let query = supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('business_id', businessId)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusParam) {
      query = query.eq('status', statusParam);
    }

    if (customerIdParam) {
      query = query.eq('customer_id', customerIdParam);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: 'tasks_query_failed' }, { status: 500 });
    }

    const tasks = ((data ?? []) as unknown[]).map((row) => dbToTask(asTaskRow(row)));
    return NextResponse.json({ ok: true, tasks, count: tasks.length });
  } catch {
    return NextResponse.json({ ok: false, error: 'tasks_query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/tasks
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
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

    // Required fields
    const title = str(raw.title);
    if (!title) {
      return NextResponse.json({ ok: false, error: 'invalid_title' }, { status: 400 });
    }

    if (!isValidEnum(raw.type, VALID_TYPES)) {
      return NextResponse.json({ ok: false, error: 'invalid_type' }, { status: 400 });
    }

    if (!isValidDueDate(raw.dueDate)) {
      return NextResponse.json({ ok: false, error: 'invalid_due_date' }, { status: 400 });
    }

    // Optional enum fields
    if (raw.status != null) {
      // Reject ai_draft explicitly
      if (raw.status === 'ai_draft') {
        return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
      }
      if (!isValidEnum(raw.status, VALID_STATUSES_WRITE)) {
        return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
      }
    }

    if (raw.priority != null && !isValidEnum(raw.priority, VALID_PRIORITIES)) {
      return NextResponse.json({ ok: false, error: 'invalid_priority' }, { status: 400 });
    }

    if (raw.dueTime != null && raw.dueTime !== '' && !isValidDueTime(raw.dueTime)) {
      return NextResponse.json({ ok: false, error: 'invalid_due_time' }, { status: 400 });
    }

    // Customer ownership validation
    const customerId = raw.customerId != null ? str(raw.customerId) : null;
    if (customerId) {
      const belongs = await validateCustomerBelongsToBusiness(supabase, customerId, businessId);
      if (!belongs) {
        return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
      }
    }

    // Offer ownership validation (prevents attaching a task to another tenant's offer).
    const rawOfferId = raw.offerId != null ? str(raw.offerId) : null;
    const offerIdClean = rawOfferId && rawOfferId.length > 0 ? rawOfferId : null;
    if (offerIdClean) {
      const offerBelongs = await validateOfferBelongsToBusiness(supabase, offerIdClean, businessId);
      if (!offerBelongs) {
        return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
      }
    }

    // workFolderId (WF-4) - optional. When present, the folder must belong to
    // this business AND the same customer as the task. Unchanged when absent.
    const folderLink = await resolveWorkFolderForCreate(supabase, businessId, raw.workFolderId, customerId);
    if (!folderLink.ok) {
      return NextResponse.json({ ok: false, error: folderLink.error }, { status: folderLink.status });
    }

    const status = isValidEnum(raw.status, VALID_STATUSES_WRITE) ? raw.status : 'open';
    const completedAt = status === 'completed' ? new Date().toISOString() : null;

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        offer_id: offerIdClean,
        title,
        type: raw.type,
        status,
        priority: isValidEnum(raw.priority, VALID_PRIORITIES) ? raw.priority : 'normal',
        due_date: raw.dueDate as string,
        due_time: (raw.dueTime != null && raw.dueTime !== '' && isValidDueTime(raw.dueTime))
          ? (raw.dueTime as string)
          : null,
        note: str(raw.note),
        created_from_ai: false,
        completed_at: completedAt,
        // Only set when filing into a folder — keeps existing inserts untouched.
        ...(folderLink.workFolderId ? { work_folder_id: folderLink.workFolderId } : {}),
      })
      .select(TASK_COLUMNS)
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'task_create_failed' }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, task: dbToTask(asTaskRow(data)) },
      { status: 201 }
    );
  } catch {
    return NextResponse.json({ ok: false, error: 'task_create_failed' }, { status: 500 });
  }
}
