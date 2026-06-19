// Canonical date formatting for the app — DD-MM-YYYY (Greek convention, hyphen
// separators). Single source of truth so every surface renders dates the same way.
// Pure functions: safe on both client and server.

/** Accepts a date-only string (YYYY-MM-DD) or a full ISO timestamp. */
export function formatDateGr(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  } catch {
    return '';
  }
}

/** DD-MM-YYYY HH:MM for timestamps. */
export function formatDateTimeGr(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${formatDateGr(iso)} ${hh}:${min}`;
  } catch {
    return '';
  }
}

const WEEKDAYS_GR = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'] as const;

/**
 * WhatsApp/Messenger-style timestamp: a day label while recent, an absolute
 * date once older than a week — always with the time-of-day.
 *   today      → "Σήμερα 14:30"
 *   yesterday  → "Χθες 14:30"
 *   2–6 days   → "Τρίτη 14:30"   (Greek weekday)
 *   ≥ 7 days   → "14-06-2026 14:30"
 * Uses the viewer's local day boundaries (the owner is in Athens).
 */
export function formatRelativeDateTimeGr(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const now = new Date();
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const nDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayDiff = Math.round((nDay.getTime() - dDay.getTime()) / 86_400_000);
    if (dayDiff === 0) return `Σήμερα ${time}`;
    if (dayDiff === 1) return `Χθες ${time}`;
    if (dayDiff >= 2 && dayDiff <= 6) return `${WEEKDAYS_GR[d.getDay()]} ${time}`;
    return `${formatDateGr(iso)} ${time}`;
  } catch {
    return '';
  }
}
