// Έργα (work folders) for one customer — authenticated business API.
//
//   GET  /api/customers/[id]/folders  → list this customer's folders (+ counts)
//   POST /api/customers/[id]/folders  → create a folder for this customer
//
// Service-role client bypasses RLS, so EVERY query is explicitly scoped by
// business_id (and customer_id). Requires migration 046 (work_folders +
// work_folder_id columns). Raw DB errors are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest, type BusinessAuthContext } from '@/lib/api/auth';
import {
  APPOINTMENT_TASK_TYPES,
  dbToFolder,
  emptyFolderCounts,
  isFolderStatus,
  orderFolders,
  validateFolderTitle,
  type FolderCounts,
  type WorkFolderRow,
} from '@/lib/server/work-folders';

export const runtime = 'nodejs';

// `step` requires migration 047 (apply before deploy, like 046).
const FOLDER_COLUMNS = 'id, business_id, customer_id, title, status, step, notes, created_at, updated_at';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type Db = BusinessAuthContext['supabase'];

/** Confirm the customer exists AND belongs to the authenticated business. */
async function customerBelongsToBusiness(
  supabase: Db,
  businessId: string,
  customerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Lightweight per-folder counts. One small query per entity table (selecting
 * only work_folder_id), tallied in JS — best-effort: a failing count query just
 * leaves that count at 0, never failing the whole list.
 */
async function loadFolderCounts(
  supabase: Db,
  businessId: string,
  folderIds: string[],
): Promise<Map<string, FolderCounts>> {
  const map = new Map<string, FolderCounts>();
  for (const id of folderIds) map.set(id, emptyFolderCounts());
  if (folderIds.length === 0) return map;

  const tally = (
    rows: unknown[] | null | undefined,
    key: keyof FolderCounts,
    pred?: (row: Record<string, unknown>) => boolean,
  ) => {
    for (const r of rows ?? []) {
      const row = r as Record<string, unknown>;
      const fid = row.work_folder_id as string | null;
      if (!fid || !map.has(fid)) continue;
      if (pred && !pred(row)) continue;
      map.get(fid)![key] += 1;
    }
  };

  try {
    const [offersRes, tasksRes, commsRes, uploadRes, intakeRes] = await Promise.all([
      supabase.from('offers').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
      supabase.from('tasks').select('work_folder_id, type').eq('business_id', businessId).in('work_folder_id', folderIds),
      supabase.from('communications').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
      supabase.from('customer_upload_tokens').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
      supabase.from('customer_intake_tokens').select('work_folder_id').eq('business_id', businessId).in('work_folder_id', folderIds),
    ]);
    tally(offersRes.data as unknown[] | null, 'offers');
    tally(tasksRes.data as unknown[] | null, 'appointments', (row) =>
      (APPOINTMENT_TASK_TYPES as readonly string[]).includes(row.type as string),
    );
    tally(commsRes.data as unknown[] | null, 'messages');
    tally(uploadRes.data as unknown[] | null, 'uploadRequests');
    tally(intakeRes.data as unknown[] | null, 'intakeRequests');
  } catch {
    // best-effort — return whatever we have (zeros)
  }
  return map;
}

// ---------------------------------------------------------------------------
// GET /api/customers/[id]/folders
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id: customerId } = await params;

    if (!(await customerBelongsToBusiness(supabase, businessId, customerId))) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('work_folders')
      .select(FOLDER_COLUMNS)
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: 'folders_query_failed' }, { status: 500 });
    }

    const rows = ((data ?? []) as unknown[]) as WorkFolderRow[];
    const countsByFolder = await loadFolderCounts(supabase, businessId, rows.map((r) => r.id));
    const folders = orderFolders(
      rows.map((r) => dbToFolder(r, countsByFolder.get(r.id) ?? emptyFolderCounts())),
    );

    return NextResponse.json({ ok: true, folders });
  } catch {
    return NextResponse.json({ ok: false, error: 'folders_query_failed' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/customers/[id]/folders
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id: customerId } = await params;

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

    const titleCheck = validateFolderTitle(raw.title);
    if (!titleCheck.ok) {
      return NextResponse.json({ ok: false, error: titleCheck.error }, { status: 400 });
    }

    let status = 'open';
    if (raw.status != null) {
      if (!isFolderStatus(raw.status)) {
        return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
      }
      status = raw.status;
    }

    if (!(await customerBelongsToBusiness(supabase, businessId, customerId))) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('work_folders')
      .insert({
        business_id: businessId,
        customer_id: customerId,
        title: titleCheck.value,
        status,
        notes: str(raw.notes),
        updated_at: now,
      })
      .select(FOLDER_COLUMNS)
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'folder_create_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, folder: dbToFolder(data as WorkFolderRow) });
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_create_failed' }, { status: 500 });
  }
}
