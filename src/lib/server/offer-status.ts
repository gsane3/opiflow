// Pure offer-status helpers — NO runtime dependencies (no Supabase/push imports),
// so they can be reused by both the side-effectful offer-accept lib AND the
// public-folder read path / unit tests without pulling server-only modules.

export const OFFER_FINAL_STATUSES = ['accepted', 'rejected', 'expired'] as const;

/** Date-only "is this before today" (server clock, ISO date compare). */
export function isBeforeToday(dateStr: string): boolean {
  return dateStr < new Date().toISOString().split('T')[0];
}

/** Whether an offer can still be accepted/rejected (not final, not expired). */
export function offerCanRespond(offer: { status: string; valid_until: string | null }): boolean {
  if ((OFFER_FINAL_STATUSES as readonly string[]).includes(offer.status)) return false;
  if (offer.valid_until && isBeforeToday(offer.valid_until)) return false;
  return true;
}
