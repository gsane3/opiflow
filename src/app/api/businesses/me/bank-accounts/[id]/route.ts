// PATCH/DELETE /api/businesses/me/bank-accounts/[id] — update or remove one bank
// account. Authenticated + business_id-scoped (the lib scopes every query by
// businessId, so an id from another business resolves as not-found). Each
// mutation re-syncs the primary account into businesses.bank_*.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { updateBankAccount, deleteBankAccount } from '@/lib/server/bank-accounts';

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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { id } = await params;

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 }); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  const raw = body as Record<string, unknown>;

  const iban = normalizeIban(raw.iban);
  if (!iban || !isValidIban(iban)) return NextResponse.json({ ok: false, error: 'invalid_iban' }, { status: 400 });

  try {
    const account = await updateBankAccount(auth.ctx.businessId, id, {
      beneficiary: cleanText(raw.beneficiary),
      bankName: cleanText(raw.bank),
      iban,
    });
    if (!account) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, account });
  } catch {
    return NextResponse.json({ ok: false, error: 'bank_unavailable' }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { id } = await params;
  try {
    await deleteBankAccount(auth.ctx.businessId, id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'bank_unavailable' }, { status: 503 });
  }
}
