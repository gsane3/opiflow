// Single source of truth for which subscription statuses grant access to the
// paid product. Replaces the allow-list that was copy-pasted across 4 API routes
// (number-requests, businesses/me, twilio-token, browser-token), so they can't
// drift apart.
//
// 'pending_payment' is intentionally EXCLUDED: a fresh self-serve signup must
// complete Stripe Checkout before access (pay-at-signup). Existing manual/pilot
// accounts ('pending_manual_review'/'trialing') stay entitled so nobody is locked
// out by the rollout. 'past_due' is excluded too (a failed renewal blocks access
// until payment recovers).

export const ENTITLED_STATUSES = ['pending_manual_review', 'trialing', 'active'] as const;

export function isEntitled(status: string | null | undefined): boolean {
  return !!status && (ENTITLED_STATUSES as readonly string[]).includes(status);
}

/** A subscription status that means "you need to pay to activate" (vs. a hard
 *  support issue) — used to choose the right CTA on gated screens. */
export function needsPayment(status: string | null | undefined): boolean {
  return status === 'pending_payment' || status === 'past_due';
}
