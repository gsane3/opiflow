// Greek phone selection for Viber/SMS sends — the single source of truth shared
// by every send route (offer notify, intake/upload/appointment link, appointment
// reminders). Previously duplicated verbatim in 5 routes. Pure + dependency-free.
//
// Rule: prefer the customer's mobile_phone; otherwise fall back to `phone` only
// when it looks like a Greek mobile (so we never try to Viber a landline).

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True for a Greek mobile (10-digit 6xxxxxxxxx or 12-digit 306xxxxxxxxx). */
export function looksLikeGreekMobile(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/[^\d]/g, '');
  return /^6\d{9}$/.test(digits) || /^306\d{9}$/.test(digits);
}

/** Choose the number to Viber/SMS, or null if none is usable. */
export function selectViberPhone(customer: { mobile_phone?: string | null; phone?: string | null }): string | null {
  const mobile = str(customer.mobile_phone);
  if (mobile) return mobile;
  const fallback = str(customer.phone);
  if (fallback && looksLikeGreekMobile(fallback)) return fallback;
  return null;
}
