// GET /api/folders/[id]/attachable — list UNFILED items that can be attached to
// this folder (WF-4). Returns the folder customer's offers + appointment-tasks
// whose work_folder_id IS NULL, so the business can pick one to file in.
//
// Business-scoped + customer-scoped (a folder from another business resolves as
// 404). Requires migration 046. Raw DB errors are never returned to the caller.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { APPOINTMENT_TASK_TYPES } from '@/lib/server/work-folders';

export const runtime = 'nodejs';

const PICK_LIMIT = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    const { id: folderId } = await params;

    // Folder must exist AND belong to the authenticated business.
    const { data: folder, error: folderErr } = await supabase
      .from('work_folders')
      .select('customer_id')
      .eq('id', folderId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (folderErr) {
      return NextResponse.json({ ok: false, error: 'attachable_failed' }, { status: 500 });
    }
    if (!folder) {
      return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    }
    const customerId = (folder as { customer_id: string }).customer_id;

    const [offersRes, apptRes] = await Promise.all([
      supabase
        .from('offers')
        .select('id, offer_number, status, total, created_at')
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .is('work_folder_id', null)
        .order('created_at', { ascending: false })
        .limit(PICK_LIMIT),
      supabase
        .from('tasks')
        .select('id, title, type, status, due_date, due_time')
        .eq('business_id', businessId)
        .eq('customer_id', customerId)
        .is('work_folder_id', null)
        .in('type', APPOINTMENT_TASK_TYPES as unknown as string[])
        .order('due_date', { ascending: false })
        .limit(PICK_LIMIT),
    ]);

    if (offersRes.error || apptRes.error) {
      return NextResponse.json({ ok: false, error: 'attachable_failed' }, { status: 500 });
    }

    const offers = ((offersRes.data ?? []) as unknown[]).map((r) => {
      const o = r as { id: string; offer_number: string | null; status: string; total: number | null };
      return { id: o.id, offerNumber: o.offer_number, status: o.status, total: o.total };
    });
    const appointments = ((apptRes.data ?? []) as unknown[]).map((r) => {
      const t = r as { id: string; title: string; type: string; status: string; due_date: string | null; due_time: string | null };
      return { id: t.id, title: t.title, type: t.type, status: t.status, dueDate: t.due_date, dueTime: t.due_time };
    });

    return NextResponse.json({ ok: true, offers, appointments });
  } catch {
    return NextResponse.json({ ok: false, error: 'attachable_failed' }, { status: 500 });
  }
}
