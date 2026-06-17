// POST /api/folders/[id]/payment-request — create a bank-transfer payment request
// (deposit/balance) for a job. Authenticated business API; service-role client so
// every query is explicitly business_id-scoped. The amount is computed SERVER-SIDE
// from the offer gross (offers.total incl. VAT) — client amounts are never trusted.
// The IBAN is snapshotted from the business's bank details. Requires migration 048.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { notifyFolderUpdate } from '@/lib/server/notify-folder-update';
import {
  computePaymentAmount,
  isPaymentKind,
  mapBusinessPayment,
  validatePct,
  PAYMENT_REQUEST_COLUMNS,
  type PaymentRequestRow,
} from '@/lib/server/payments';

export const runtime = 'nodejs';

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

    if (!isPaymentKind(raw.kind)) {
      return NextResponse.json({ ok: false, error: 'invalid_kind' }, { status: 400 });
    }
    const kind = raw.kind;
    const pctCheck = validatePct(raw.pct);
    if (!pctCheck.ok) {
      return NextResponse.json({ ok: false, error: pctCheck.error }, { status: 400 });
    }
    const pct = pctCheck.value;
    if (typeof raw.offerId !== 'string' || raw.offerId.trim().length === 0) {
      return NextResponse.json({ ok: false, error: 'offer_required' }, { status: 400 });
    }
    const offerId = raw.offerId;

    // Folder must exist + belong to this business (→ customer_id).
    const { data: folderData, error: folderErr } = await supabase
      .from('work_folders')
      .select('id, customer_id')
      .eq('id', folderId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (folderErr) return NextResponse.json({ ok: false, error: 'payment_request_failed' }, { status: 500 });
    if (!folderData) return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    const folder = folderData as unknown as { id: string; customer_id: string | null };

    // Offer must be in THIS folder + business (the gross source). Scoped by all three.
    const { data: offerData, error: offerErr } = await supabase
      .from('offers')
      .select('id, total')
      .eq('id', offerId)
      .eq('business_id', businessId)
      .eq('work_folder_id', folderId)
      .maybeSingle();
    if (offerErr) return NextResponse.json({ ok: false, error: 'payment_request_failed' }, { status: 500 });
    if (!offerData) return NextResponse.json({ ok: false, error: 'offer_not_found' }, { status: 404 });
    const offer = offerData as unknown as { id: string; total: number | null };

    // Snapshot the business IBAN (requires migration 048). No IBAN → can't request.
    const { data: bizData, error: bizErr } = await supabase
      .from('businesses')
      .select('bank_iban, bank_beneficiary')
      .eq('id', businessId)
      .maybeSingle();
    if (bizErr) return NextResponse.json({ ok: false, error: 'payment_request_failed' }, { status: 500 });
    const biz = (bizData as unknown as { bank_iban: string | null; bank_beneficiary: string | null } | null) ?? null;
    const iban = biz?.bank_iban?.trim() || null;
    if (!iban) {
      return NextResponse.json({ ok: false, error: 'bank_not_configured' }, { status: 400 });
    }

    const amount = computePaymentAmount(typeof offer.total === 'number' ? offer.total : 0, pct);
    const now = new Date().toISOString();

    const { data: inserted, error: insErr } = await supabase
      .from('payment_requests')
      .insert({
        business_id: businessId,
        customer_id: folder.customer_id,
        work_folder_id: folderId,
        offer_id: offer.id,
        kind,
        pct,
        amount,
        currency: 'EUR',
        status: 'pending',
        receiving_account: iban,
        updated_at: now,
      })
      .select(PAYMENT_REQUEST_COLUMNS)
      .single();

    if (insErr || !inserted) {
      return NextResponse.json({ ok: false, error: 'payment_request_failed' }, { status: 500 });
    }

    // γ — auto-notify the customer about the new payment request.
    void notifyFolderUpdate({ businessId, workFolderId: folderId, what: kind === 'deposit' ? 'αίτημα προκαταβολής' : 'αίτημα εξόφλησης' }).catch(() => {});
    return NextResponse.json({ ok: true, payment: mapBusinessPayment(inserted as unknown as PaymentRequestRow) });
  } catch {
    return NextResponse.json({ ok: false, error: 'payment_request_failed' }, { status: 500 });
  }
}
