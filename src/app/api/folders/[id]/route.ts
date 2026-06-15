// PATCH /api/folders/[id] — update one Φάκελος εργασίας (title / notes / status).
//
// Service-role client bypasses RLS, so the folder is always scoped by
// business_id (a folder from another business resolves as not found → 404).
// Requires migration 046. Raw DB errors are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { dbToFolder, isFolderStatus, validateFolderTitle, type WorkFolderRow } from '@/lib/server/work-folders';

export const runtime = 'nodejs';

const FOLDER_COLUMNS = 'id, business_id, customer_id, title, status, notes, created_at, updated_at';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
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
