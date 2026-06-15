// PATCH /api/folders/[id] — update one Φάκελος εργασίας (title / notes / status).
//
// Service-role client bypasses RLS, so the folder is always scoped by
// business_id (a folder from another business resolves as not found → 404).
// Requires migration 046. Raw DB errors are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  APPOINTMENT_TASK_TYPES,
  dbToFolder,
  isFolderStatus,
  validateFolderTitle,
  type FolderCounts,
  type WorkFolderRow,
} from '@/lib/server/work-folders';

export const runtime = 'nodejs';

const FOLDER_COLUMNS = 'id, business_id, customer_id, title, status, notes, created_at, updated_at';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// GET /api/folders/[id] — folder detail with per-section counts + latest items.
// Business-scoped (a folder from another business resolves as 404). The attached
// items are read by work_folder_id; the public page is unaffected (separate
// loader). This is the authenticated business view, so summaries are fine here.
// ---------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id: folderId } = await params;

    const { data: folderData, error: folderErr } = await supabase
      .from('work_folders')
      .select(FOLDER_COLUMNS)
      .eq('id', folderId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (folderErr) {
      return NextResponse.json({ ok: false, error: 'folder_detail_failed' }, { status: 500 });
    }
    if (!folderData) {
      return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    }
    const folderRow = folderData as unknown as WorkFolderRow;

    const [custRes, offersRes, apptRes, msgRes, photoRes, intakeRes] = await Promise.all([
      supabase
        .from('customers')
        .select('id, name, company_name, crm_number, phone, mobile_phone, email')
        .eq('id', folderRow.customer_id)
        .eq('business_id', businessId)
        .maybeSingle(),
      supabase
        .from('offers')
        .select('id, offer_number, status, total, created_at', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('work_folder_id', folderId)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('tasks')
        .select('id, title, type, status, due_date, due_time, created_at', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('work_folder_id', folderId)
        .in('type', APPOINTMENT_TASK_TYPES as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('communications')
        .select('id, summary, direction, channel, created_at', { count: 'exact' })
        .eq('business_id', businessId)
        .eq('work_folder_id', folderId)
        .order('created_at', { ascending: false })
        .limit(3),
      supabase
        .from('customer_upload_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('work_folder_id', folderId),
      supabase
        .from('customer_intake_tokens')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('work_folder_id', folderId),
    ]);

    const counts: FolderCounts = {
      offers: offersRes.count ?? 0,
      appointments: apptRes.count ?? 0,
      messages: msgRes.count ?? 0,
      uploadRequests: photoRes.count ?? 0,
      intakeRequests: intakeRes.count ?? 0,
    };

    const cust = custRes.data as
      | { id: string; name: string | null; company_name: string | null; crm_number: string | null; phone: string | null; mobile_phone: string | null; email: string | null }
      | null;
    const customer = cust
      ? {
          id: cust.id,
          name: cust.name ?? cust.company_name ?? cust.crm_number ?? null,
          phone: cust.phone ?? cust.mobile_phone ?? null,
          email: cust.email,
        }
      : null;

    const offers = ((offersRes.data ?? []) as unknown[]).map((r) => {
      const o = r as { id: string; offer_number: string | null; status: string; total: number | null; created_at: string };
      return { id: o.id, offerNumber: o.offer_number, status: o.status, total: o.total, createdAt: o.created_at };
    });
    const appointments = ((apptRes.data ?? []) as unknown[]).map((r) => {
      const t = r as { id: string; title: string; type: string; status: string; due_date: string | null; due_time: string | null };
      return { id: t.id, title: t.title, type: t.type, status: t.status, dueDate: t.due_date, dueTime: t.due_time };
    });
    const messages = ((msgRes.data ?? []) as unknown[]).map((r) => {
      const m = r as { id: string; summary: string | null; direction: string; channel: string; created_at: string };
      return { id: m.id, summary: m.summary, direction: m.direction, channel: m.channel, createdAt: m.created_at };
    });

    return NextResponse.json({
      ok: true,
      folder: dbToFolder(folderRow, counts),
      customer,
      sections: {
        offers: { count: counts.offers, items: offers },
        appointments: { count: counts.appointments, items: appointments },
        messages: { count: counts.messages, items: messages },
        photos: { count: counts.uploadRequests },
        intake: { count: counts.intakeRequests },
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_detail_failed' }, { status: 500 });
  }
}

export async function PATCH(
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
    const { id: folderId } = await params;

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

    // Validate any provided fields up front.
    let title: string | undefined;
    if ('title' in raw) {
      const titleCheck = validateFolderTitle(raw.title);
      if (!titleCheck.ok) {
        return NextResponse.json({ ok: false, error: titleCheck.error }, { status: 400 });
      }
      title = titleCheck.value;
    }
    if (raw.status != null && !isFolderStatus(raw.status)) {
      return NextResponse.json({ ok: false, error: 'invalid_status' }, { status: 400 });
    }

    const updateFields: Record<string, unknown> = {};
    let hasUpdate = false;
    if (title !== undefined) { updateFields.title = title; hasUpdate = true; }
    if ('status' in raw && isFolderStatus(raw.status)) { updateFields.status = raw.status; hasUpdate = true; }
    if ('notes' in raw) { updateFields.notes = str(raw.notes); hasUpdate = true; }

    // Nothing to change → return the current folder (business-scoped).
    if (!hasUpdate) {
      const { data, error } = await supabase
        .from('work_folders')
        .select(FOLDER_COLUMNS)
        .eq('id', folderId)
        .eq('business_id', businessId)
        .maybeSingle();
      if (error) {
        return NextResponse.json({ ok: false, error: 'folder_update_failed' }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, folder: dbToFolder(data as WorkFolderRow) });
    }

    updateFields.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('work_folders')
      .update(updateFields)
      .eq('id', folderId)
      .eq('business_id', businessId)
      .select(FOLDER_COLUMNS)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'folder_update_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, folder: dbToFolder(data as WorkFolderRow) });
  } catch {
    return NextResponse.json({ ok: false, error: 'folder_update_failed' }, { status: 500 });
  }
}
