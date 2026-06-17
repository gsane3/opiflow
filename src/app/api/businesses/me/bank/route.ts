// GET/PATCH /api/businesses/me/bank — the business's bank-transfer details
// (beneficiary / bank / IBAN), shown to the customer on the portal payment card
// and the offer PDF. DELIBERATELY SEPARATE from /api/businesses/me so the new
// columns never touch the login/onboarding-critical select: that route's allowlist
// stays unchanged, and this endpoint reads/writes the bank columns TOLERANTLY
// (pre-migration-048 the columns are absent → GET returns nulls, PATCH 503s) so
// nothing here can break sign-in. Authenticated + business_id-scoped (service-role).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { listBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount, syncPrimaryBank } from '@/lib/server/bank-accounts';

export const runtime = 'nodejs';

const MAX_LEN = 200;

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > MAX_LEN ? t.slice(0, MAX_LEN) : t;
}

/** Normalize an IBAN: strip spaces, upper-case. */
function normalizeIban(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toUpperCase();
  return s.length > 0 ? s : null;
}

/** Loose structural IBAN check (2 letters + 2 digits + 11–30 alphanumerics). */
function isValidIban(s: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s);
}

interface BankRow {
  bank_beneficiary: string | null;
  bank_name: string | null;
  bank_iban: string | null;
}
function mapBank(row: BankRow | null) {
  return {
    beneficiary: row?.bank_beneficiary ?? null,
    bank: row?.bank_name ?? null,
    iban: row?.bank_iban ?? null,
  };
}

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  // Tolerant: pre-048 the columns don't exist → return empty bank, never 500
  // (so Settings still renders and login/onboarding are wholly unaffected).
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('bank_beneficiary, bank_name, bank_iban')
      .eq('id', businessId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: true, bank: mapBank(null) });
    return NextResponse.json({ ok: true, bank: mapBank((data as unknown as BankRow | null) ?? null) });
  } catch {
    return NextResponse.json({ ok: true, bank: mapBank(null) });
  }
}

export async function PATCH(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { businessId } = auth.ctx;

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

  let iban: string | null = null;
  if (raw.iban !== undefined && raw.iban !== null && raw.iban !== '') {
    iban = normalizeIban(raw.iban);
    if (!iban || !isValidIban(iban)) {
      return NextResponse.json({ ok: false, error: 'invalid_iban' }, { status: 400 });
    }
  }

  // This endpoint edits the PRIMARY bank account. It writes THROUGH to the
  // business_bank_accounts table (single source of truth) + re-syncs the mirror,
  // so it stays consistent with the web multi-account manager (and the still-used
  // native bank editor) instead of writing businesses.bank_* directly.
  try {
    const beneficiary = cleanText(raw.beneficiary);
    const bank = cleanText(raw.bank);

    if (!iban) {
      // Clearing the bank: drop the primary account (next becomes primary, if any).
      const accounts = await listBankAccounts(businessId);
      if (accounts.length > 0) await deleteBankAccount(businessId, accounts[0].id);
      else await syncPrimaryBank(businessId);
      return NextResponse.json({ ok: true, bank: mapBank(null) });
    }

    const accounts = await listBankAccounts(businessId);
    const primary = accounts[0];
    const saved = primary
      ? await updateBankAccount(businessId, primary.id, { beneficiary, bankName: bank, iban })
      : await createBankAccount(businessId, { beneficiary, bankName: bank, iban });
    return NextResponse.json({
      ok: true,
      bank: { beneficiary: saved?.beneficiary ?? beneficiary, bank: saved?.bankName ?? bank, iban: saved?.iban ?? iban },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'bank_unavailable' }, { status: 503 });
  }
}
