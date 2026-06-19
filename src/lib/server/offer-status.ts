// Pure offer-status helpers — NO runtime dependencies (no Supabase/push imports),
// so they can be reused by both the side-effectful offer-accept lib AND the
// public-folder read path / unit tests without pulling server-only modules.

export const OFFER_FINAL_STATUSES = ['accepted', 'rejected', 'expired'] as const;

/** Today's date (YYYY-MM-DD) in Europe/Athens — DST-correct via Intl, so an
 *  offer/appointment whose date is "today" in Greece is never treated as expired
 *  just because the server (UTC) clock has already rolled past midnight. */
export function athensToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Date-only "is this before today" — compared against the Athens calendar day. */
export function isBeforeToday(dateStr: string): boolean {
  return dateStr < athensToday();
}

/** Whether an offer can still be accepted/rejected (not final, not expired). */
export function offerCanRespond(offer: { status: string; valid_until: string | null }): boolean {
  if ((OFFER_FINAL_STATUSES as readonly string[]).includes(offer.status)) return false;
  if (offer.valid_until && isBeforeToday(offer.valid_until)) return false;
  return true;
}
