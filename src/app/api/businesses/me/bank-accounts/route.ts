// GET/POST /api/businesses/me/bank-accounts — the business's bank accounts
// (Settings → Τραπεζικά, multiple). Authenticated + business_id-scoped (the lib
// uses the service role and scopes every query by businessId). The PRIMARY
// account is mirrored into businesses.bank_* so the customer-facing read paths
// (payment card / offer PDF) stay unchanged. Tolerant of pre-051 (table absent):
// GET returns an empty list, POST returns 503 so Settings never hard-breaks.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { listBankAccounts, createBankAccount } from '@/lib/server/bank-accounts';

export const runtime = 'nodejs';

const MAX_LEN = 200;
function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.length > MAX_LEN ? t.slice(0, MAX_LEN) : t;
}
function normalizeIban(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').toUpperCase();
  return s.length > 0 ? s : null;
}
function isValidIban(s: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s);
}

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  try {
    const accounts = await listBankAccounts(auth.ctx.businessId);
    return NextResponse.json({ ok: true, accounts });
  } catch {
    // Pre-051 (table absent) — keep Settings rendering with an empty list.
    return NextResponse.json({ ok: true, accounts: [] });
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  const raw = body as Record<string, unknown>;

  const iban = normalizeIban(raw.iban);
  if (!iban || !isValidIban(iban)) return NextResponse.json({ ok: false, error: 'invalid_iban' }, { status: 400 });

  try {
    const account = await createBankAccount(auth.ctx.businessId, {
      beneficiary: cleanText(raw.beneficiary),
      bankName: cleanText(raw.bank),
      iban,
    });
    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch {
    return NextResponse.json({ ok: false, error: 'bank_unavailable' }, { status: 503 });
  }
}
