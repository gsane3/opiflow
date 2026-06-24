// SINGLE SOURCE OF TRUTH for Opiflow's subscription pricing.
//
// Every customer-facing surface (landing, /package, /terms, onboarding, Settings)
// AND Stripe must read the price from here so the three pages can never drift
// apart again (the pre-launch audit found landing/package/terms each quoting a
// different price + plan name). One plan, billed monthly, pay-at-signup.
//
// The plan maps to the already-seeded package_plans.plan_key 'pro' so no DB
// migration is required for the price to be consistent.

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

/** Greek-style currency formatting (comma decimal): 29.95 → "29,95€". */
export function formatEur(n: number): string {
  return `${n.toFixed(2).replace('.', ',')}€`;
}

export const PLAN_PRICE_EX_VAT_LABEL = `${formatEur(PLAN.priceExVat)} + ΦΠΑ`;
export const PLAN_PRICE_INC_VAT_LABEL = `${formatEur(PLAN_PRICE_INC_VAT)} με ΦΠΑ`;

/** What the plan includes — one list, reused by /package and /terms. */
export const PLAN_FEATURES = [
  'Επαγγελματικό τηλέφωνο & κλήσεις',
  'Αυτόματη σύνοψη κλήσεων με AI',
  'Πελάτες, προσφορές & ραντεβού',
  'Αιτήματα στοιχείων/φωτογραφιών & αυτοματισμοί',
] as const;
