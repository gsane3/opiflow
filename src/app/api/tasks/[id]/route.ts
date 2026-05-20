// CRM task get-by-id and patch endpoints.
// Phase 3: business isolation enforced via explicit business_id + id filter on every query.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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

// Statuses allowed for manual write (ai_draft excluded).
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

function getBearerToken(request: NextRequest): string | null {
  const h = request.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
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

// ---------------------------------------------------------------------------
// Business lookup
// ---------------------------------------------------------------------------

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

async function getBusinessId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  return (data as unknown as { id: string } | null)?.id ?? null;
}

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

// ---------------------------------------------------------------------------
// GET /api/tasks/[id]
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'task_query_failed' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const businessId = await getBusinessId(supabase, user.id);
    if (!businessId) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    const { id } = await params;

    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('id', id)
      .eq('business_id', businessId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'task_query_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, task: dbToTask(asTaskRow(data)) });
  } catch {
    return NextResponse.json({ ok: false, error: 'task_query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/tasks/[id]
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'task_update_failed' }, { status: 500 });
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }

    const businessId = await getBusinessId(supabase, user.id);
    if (!businessId) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }

    const { id } = await params;

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

    // Validate before building update object
    if ('title' in raw) {
      if (!str(raw.title)) {
        return NextResponse.json({ ok: false, error: 'invalid_title' }, { status: 400 });
      }
    }

    if ('type' in raw && !isValidEnum(raw.type, VALID_TYPES)) {
      return NextResponse.json({ ok: false, error: 'invalid_type' }, { status: 400 });
    }

    if ('status' in raw) {
      if (raw.status === 'ai_draft') {
        return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
      }
      if (!isValidEnum(raw.status, VALID_STATUSES_WRITE)) {
        return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
      }
    }

    if ('priority' in raw && !isValidEnum(raw.priority, VALID_PRIORITIES)) {
      return NextResponse.json({ ok: false, error: 'invalid_priority' }, { status: 400 });
    }

    if ('dueDate' in raw && !isValidDueDate(raw.dueDate)) {
      return NextResponse.json({ ok: false, error: 'invalid_due_date' }, { status: 400 });
    }

    if ('dueTime' in raw && raw.dueTime !== null && raw.dueTime !== '' && !isValidDueTime(raw.dueTime)) {
      return NextResponse.json({ ok: false, error: 'invalid_due_time' }, { status: 400 });
    }

    // completedAt explicit null while status is completed is invalid
    if ('completedAt' in raw && raw.completedAt === null) {
      const incomingStatus = 'status' in raw ? raw.status : undefined;
      if (incomingStatus === 'completed') {
        return NextResponse.json({ ok: false, error: 'invalid_completed_at' }, { status: 400 });
      }
    }

    // Customer ownership validation
    if ('customerId' in raw && raw.customerId !== null) {
      const customerId = str(raw.customerId);
      if (customerId) {
        const belongs = await validateCustomerBelongsToBusiness(supabase, customerId, businessId);
        if (!belongs) {
          return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
        }
      }
    }

    // Build update object from allowed fields only
    const updateFields: Record<string, unknown> = {};
    let hasUpdate = false;

    if ('title' in raw) { updateFields.title = str(raw.title); hasUpdate = true; }
    if ('type' in raw && isValidEnum(raw.type, VALID_TYPES)) {
      updateFields.type = raw.type; hasUpdate = true;
    }
    if ('status' in raw && isValidEnum(raw.status, VALID_STATUSES_WRITE)) {
      updateFields.status = raw.status; hasUpdate = true;
    }
    if ('priority' in raw && isValidEnum(raw.priority, VALID_PRIORITIES)) {
      updateFields.priority = raw.priority; hasUpdate = true;
    }
    if ('dueDate' in raw && isValidDueDate(raw.dueDate)) {
      updateFields.due_date = raw.dueDate; hasUpdate = true;
    }
    if ('dueTime' in raw) {
      updateFields.due_time = (raw.dueTime === null || raw.dueTime === '') ? null : raw.dueTime;
      hasUpdate = true;
    }
    if ('note' in raw) { updateFields.note = str(raw.note); hasUpdate = true; }
    if ('customerId' in raw) {
      updateFields.customer_id = raw.customerId === null ? null : str(raw.customerId);
      hasUpdate = true;
    }
    if ('offerId' in raw) {
      updateFields.offer_id = raw.offerId === null ? null : str(raw.offerId);
      hasUpdate = true;
    }

    // completedAt explicit handling
    if ('completedAt' in raw) {
      if (raw.completedAt === null) {
        // Already validated above that status is not 'completed' in this branch
        updateFields.completed_at = null;
      } else {
        updateFields.completed_at = str(raw.completedAt);
      }
      hasUpdate = true;
    } else if ('status' in raw && isValidEnum(raw.status, VALID_STATUSES_WRITE) && raw.status === 'completed') {
      // Auto-set completed_at when transitioning to completed and caller did not provide it
      updateFields.completed_at = new Date().toISOString();
      hasUpdate = true;
    }

    // If no allowed fields were provided, return the current task unchanged
    if (!hasUpdate) {
      const { data: existing, error: fetchError } = await supabase
        .from('tasks')
        .select(TASK_COLUMNS)
        .eq('id', id)
        .eq('business_id', businessId)
        .maybeSingle();

      if (fetchError) {
        return NextResponse.json({ ok: false, error: 'task_update_failed' }, { status: 500 });
      }
      if (!existing) {
        return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, task: dbToTask(asTaskRow(existing)) });
    }

    updateFields.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('tasks')
      .update(updateFields)
      .eq('id', id)
      .eq('business_id', businessId)
      .select(TASK_COLUMNS)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'task_update_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, task: dbToTask(asTaskRow(data)) });
  } catch {
    return NextResponse.json({ ok: false, error: 'task_update_failed' }, { status: 500 });
  }
}
