// SINGLE SOURCE OF TRUTH for Opiflow's subscription pricing.
//
// Every customer-facing surface (landing, /package, /terms, onboarding, Settings)
// AND Stripe must read the price from here so the three pages can never drift
// apart again (the pre-launch audit found landing/package/terms each quoting a
// different price + plan name). One plan, billed monthly, pay-at-signup.
//
// The plan maps to the already-seeded package_plans.plan_key 'pro' so no DB
// migration is required for the price to be consistent.

import { fmtEur } from '@/lib/offer-calculations';

export const VAT_RATE = 0.24; // Greek ΦΠΑ

export const PLAN = {
  /** Maps to the existing seeded package_plans.plan_key (no migration needed). */
  key: 'pro',
  name: 'Opiflow',
  priceExVat: 29.95,
  currency: 'EUR',
} as const;

/** Price incl. 24% ΦΠΑ, rounded to cents (29.95 → 37.14). */
export const PLAN_PRICE_INC_VAT = Math.round(PLAN.priceExVat * (1 + VAT_RATE) * 100) / 100;

// Currency formatting delegates to the single app-wide formatter so pricing,
// offers and the customer document all read identically (Greek-canonical "29,95 €").
export const formatEur = fmtEur;

export const PLAN_PRICE_EX_VAT_LABEL = `${formatEur(PLAN.priceExVat)} + ΦΠΑ`;
export const PLAN_PRICE_INC_VAT_LABEL = `${formatEur(PLAN_PRICE_INC_VAT)} με ΦΠΑ`;

/** What the plan includes — one list, reused by /package and /terms. */
export const PLAN_FEATURES = [
  'Επαγγελματικό τηλέφωνο & κλήσεις',
  'Αυτόματη σύνοψη κλήσεων με AI',
  'Πελάτες, προσφορές & ραντεβού',
  'Αιτήματα στοιχείων/φωτογραφιών & αυτοματισμοί',
] as const;
