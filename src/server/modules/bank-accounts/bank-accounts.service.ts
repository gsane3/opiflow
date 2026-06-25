// Bank accounts — service (validation + manager-gated CRUD). Parity-matched to
// /api/businesses/me/bank-accounts and .../[id].
//
// The data layer already exists as the tenant-scoped lib `src/lib/server/bank-accounts`
// (service-role, every query scoped by business_id, primary mirrored into businesses.bank_*).
// This service wraps it with the route's exact validation (invalid_iban) and the same
// pre-051 tolerance: list degrades to [] when the table is absent, writes surface
// `bank_unavailable` (503). IBANs are owner/admin-only — the route enforces that via
// `assertManager` before calling in.

import { AppError } from '../../core/errors';
import {
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
  type BankAccount,
} from '../../../lib/server/bank-accounts';

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

/** List accounts; tolerant of a pre-051 schema (table absent) → empty list. */
export async function listAccounts(businessId: string): Promise<BankAccount[]> {
  try {
    return await listBankAccounts(businessId);
  } catch {
    return [];
  }
}

/** Create an account. invalid_iban (400) on a bad IBAN; bank_unavailable (503) pre-051. */
export async function createAccount(
  businessId: string,
  raw: Record<string, unknown>,
): Promise<BankAccount> {
  const iban = normalizeIban(raw.iban);
  if (!iban || !isValidIban(iban)) throw new AppError('invalid_iban', 400);
  try {
    return await createBankAccount(businessId, {
      beneficiary: cleanText(raw.beneficiary),
      bankName: cleanText(raw.bank),
      iban,
    });
  } catch {
    throw new AppError('bank_unavailable', 503);
  }
}

/** Update an account. invalid_iban (400); not_found (404) for a missing id; bank_unavailable (503). */
export async function updateAccount(
  businessId: string,
  id: string,
  raw: Record<string, unknown>,
): Promise<BankAccount> {
  const iban = normalizeIban(raw.iban);
  if (!iban || !isValidIban(iban)) throw new AppError('invalid_iban', 400);
  let account: BankAccount | null;
  try {
    account = await updateBankAccount(businessId, id, {
      beneficiary: cleanText(raw.beneficiary),
      bankName: cleanText(raw.bank),
      iban,
    });
  } catch {
    throw new AppError('bank_unavailable', 503);
  }
  if (!account) throw new AppError('not_found', 404);
  return account;
}

/** Delete an account. bank_unavailable (503) pre-051. */
export async function deleteAccount(businessId: string, id: string): Promise<void> {
  try {
    await deleteBankAccount(businessId, id);
  } catch {
    throw new AppError('bank_unavailable', 503);
  }
}
