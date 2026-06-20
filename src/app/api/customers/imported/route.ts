// DELETE /api/customers/imported
//
// Bulk-delete contacts for the authenticated business. Two scopes (query param):
//   • ?scope=imported (default) — only phone-imported contacts
//     (imported_from_phone = true). App/CRM contacts (calls, projects, manual)
//     are NOT touched.
//   • ?scope=all — EVERY contact for the business (used by «Διαγραφή όλων των
//     επαφών»). Works even on a pre-053 schema (no imported_from_phone column),
//     since it doesn't filter on that column.
//
// Child rows are handled by the schema FKs (work_folders.customer_id CASCADE;
// offers/tasks/communications/payments SET NULL; intake/upload tokens CASCADE).
//
// The imported scope is tolerant of a pre-053 schema (missing column): it
// returns { ok: true, deleted: 0, columnMissing: true } so the UI can hint that
// «Διαγραφή όλων» is the way to clear contacts until migration 053 is applied.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  const msg = (error.message ?? '').toLowerCase();
  return msg.includes('imported_from_phone') || (msg.includes('column') && msg.includes('does not exist'));
}

export async function DELETE(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  const scope = request.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'imported';

  try {
    if (scope === 'all') {
      const { data, error } = await supabase
        .from('customers')
        .delete()
        .eq('business_id', businessId)
        .select('id');
      if (error) {
        return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
      }
      return NextResponse.json({ ok: true, deleted: Array.isArray(data) ? data.length : 0, scope: 'all' });
    }

    const { data, error } = await supabase
      .from('customers')
      .delete()
      .eq('business_id', businessId)
      .eq('imported_from_phone', true)
      .select('id');

    if (error) {
      if (isMissingColumnError(error)) {
        // Pre-053: the flag column doesn't exist, so no contact is marked
        // imported. Tell the UI so it can steer the user to «Διαγραφή όλων».
        return NextResponse.json({ ok: true, deleted: 0, columnMissing: true });
      }
      return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: Array.isArray(data) ? data.length : 0, scope: 'imported' });
  } catch {
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
}
