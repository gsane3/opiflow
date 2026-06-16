// Pure payments helpers — NO runtime deps (no Supabase/push), so routes + unit
// tests share them. The app NEVER moves money: it records a requested amount +
// the business IBAN; the customer self-reports ('declared'); the owner confirms
// ('confirmed', the only authoritative state). Amounts are ALWAYS computed here
// from the offer gross (offers.total already includes VAT) — never trusted from
// the client. Requires migration 048 (payment_requests + businesses bank cols).

import { round2 } from '../offer-totals';

export const PAYMENT_KINDS = ['deposit', 'balance'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATUSES = ['pending', 'declared', 'confirmed', 'cancelled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Once confirmed or cancelled, a request is settled — no further transitions.
export const PAYMENT_FINAL_STATUSES = ['confirmed', 'cancelled'] as const;

export function isPaymentKind(v: unknown): v is PaymentKind {
  return typeof v === 'string' && (PAYMENT_KINDS as readonly string[]).includes(v);
}

/** Validate a client-supplied percentage (0 < pct ≤ 100). */
export function validatePct(v: unknown): { ok: true; value: number } | { ok: false; error: 'invalid_pct' } {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100) {
    return { ok: false, error: 'invalid_pct' };
  }
  return { ok: true, value: v };
}

/** Amount = gross × pct / 100, rounded to cents. Server-authoritative. */
export function computePaymentAmount(grossTotal: number, pct: number): number {
  if (!Number.isFinite(grossTotal) || grossTotal < 0) return 0;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return round2((grossTotal * pct) / 100);
}

// ---------------------------------------------------------------------------
// Row type + mappers
// ---------------------------------------------------------------------------

export interface PaymentRequestRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  work_folder_id: string | null;
  offer_id: string | null;
  kind: string;
  pct: number | null;
  amount: number;
  currency: string;
  status: string;
  receiving_account: string | null;
  declared_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Business-side view (authenticated owner UI). */
export interface BusinessPayment {
  id: string;
  kind: string;
  pct: number | null;
  amount: number;
  currency: string;
  status: string;
  receivingAccount: string | null;
  declaredAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

export function mapBusinessPayment(row: PaymentRequestRow): BusinessPayment {
  return {
    id: row.id,
    kind: row.kind,
    pct: row.pct,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    receivingAccount: row.receiving_account,
    declaredAt: row.declared_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

/**
 * Customer-facing payment card (public portal). Exposes ONLY the amount, the
 * receiving IBAN snapshot (the customer needs it to pay), and the status — never
 * any internal id beyond the payment-request id used to declare it.
 */
export interface PublicPayment {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  status: string;
  receivingAccount: string | null;
}

export function mapPublicPayment(row: PaymentRequestRow): PublicPayment {
  return {
    id: row.id,
    kind: row.kind,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    receivingAccount: row.receiving_account,
  };
}

export const PAYMENT_REQUEST_COLUMNS =
  'id, business_id, customer_id, work_folder_id, offer_id, kind, pct, amount, currency, status, receiving_account, declared_at, confirmed_at, created_at, updated_at';
