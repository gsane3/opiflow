// DELETE /api/customers/imported
//
// Removes ALL phone-imported contacts (imported_from_phone = true) for the
// authenticated business. Powers the "Διαγραφή εισαγόμενων επαφών" button in
// Settings. Scoped to the caller's own business — app/CRM contacts (from calls,
// projects, manual entry) are never touched.
//
// Tolerant of a pre-053 schema (no imported_from_phone column): returns
// { ok: true, deleted: 0 } instead of erroring.

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

  try {
    const { data, error } = await supabase
      .from('customers')
      .delete()
      .eq('business_id', businessId)
      .eq('imported_from_phone', true)
      .select('id');

    if (error) {
      if (isMissingColumnError(error)) {
        return NextResponse.json({ ok: true, deleted: 0 });
      }
      return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deleted: Array.isArray(data) ? data.length : 0 });
  } catch {
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
}
