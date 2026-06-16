// POST /api/folders/[id]/attach — file an existing record into a folder, or
// remove it. Body: { entityType, entityId, attach }.
//
//   attach=true  → set work_folder_id = folder.id
//   attach=false → set work_folder_id = null
//
// Multi-tenant safety is enforced with EXPLICIT business_id / customer_id filters
// (never the DB FK alone), under the service-role client which bypasses RLS:
//   * cross-business entity → resolves as not found (404), never touched
//   * attaching another customer's record into this folder → 409 customer_mismatch
//
// Requires migration 046. Raw DB errors are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { ATTACHABLE_ENTITIES, isAttachableEntityType } from '@/lib/server/work-folders';

export const runtime = 'nodejs';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

    if (!isAttachableEntityType(raw.entityType)) {
      return NextResponse.json({ ok: false, error: 'invalid_entity_type' }, { status: 400 });
    }
    const entityId = str(raw.entityId);
    if (!entityId) {
      return NextResponse.json({ ok: false, error: 'invalid_entity_id' }, { status: 400 });
    }
    if (typeof raw.attach !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'invalid_attach' }, { status: 400 });
    }
    const attach = raw.attach;
    const table = ATTACHABLE_ENTITIES[raw.entityType];

    // 1) Folder must exist AND belong to the authenticated business.
    const { data: folder, error: folderErr } = await supabase
      .from('work_folders')
      .select('id, customer_id')
      .eq('id', folderId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (folderErr) {
      return NextResponse.json({ ok: false, error: 'attach_failed' }, { status: 500 });
    }
    if (!folder) {
      return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    }
    const folderCustomerId = (folder as { customer_id: string }).customer_id;

    // 2) Entity must exist AND belong to the same business (business_id filter →
    //    a cross-business entity resolves as not found).
    const { data: entity, error: entityErr } = await supabase
      .from(table)
      .select('id, customer_id')
      .eq('id', entityId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (entityErr) {
      return NextResponse.json({ ok: false, error: 'attach_failed' }, { status: 500 });
    }
    if (!entity) {
      return NextResponse.json({ ok: false, error: 'entity_not_found' }, { status: 404 });
    }

    // 3) When attaching, the entity must belong to the SAME customer as the
    //    folder (a null/different customer_id is a mismatch).
    if (attach && (entity as { customer_id: string | null }).customer_id !== folderCustomerId) {
      return NextResponse.json({ ok: false, error: 'customer_mismatch' }, { status: 409 });
    }

    // 4) Apply. Re-assert the filters on the UPDATE itself (defense in depth);
    //    on attach also pin customer_id so a race can't file a wrong-customer row.
    let update = supabase
      .from(table)
      .update({ work_folder_id: attach ? folderId : null })
      .eq('id', entityId)
      .eq('business_id', businessId);
    if (attach) update = update.eq('customer_id', folderCustomerId);

    const { error: updateErr } = await update;
    if (updateErr) {
      return NextResponse.json({ ok: false, error: 'attach_failed' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      entityType: raw.entityType,
      entityId,
      attached: attach,
      workFolderId: attach ? folderId : null,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'attach_failed' }, { status: 500 });
  }
}
