// Business-hours helper (Europe/Athens). Used to decide whether a missed call
// happened after hours, for the after-hours auto-reply.

export interface BusinessHours {
  days: number[]; // ISO weekday 1=Mon..7=Sun
  open: string;   // "HH:MM"
  close: string;  // "HH:MM"
}

const WEEKDAY_NUM: Record<string, number> = {
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7,
};

function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * True when `date` (default now) falls inside the configured business hours,
 * evaluated in Europe/Athens local time. Returns true when no hours are
 * configured (treat as always-open) so callers can decide their own default.
 */
export function isWithinBusinessHours(hours: BusinessHours | null | undefined, date: Date = new Date()): boolean {
  if (!hours || hours.days.length === 0) return true;
  const open = toMinutes(hours.open);
  const close = toMinutes(hours.close);
  if (open === null || close === null) return true;

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  const wd = WEEKDAY_NUM[weekday];
  if (!wd || !hours.days.includes(wd)) return false;

  const cur = hh * 60 + mm;
  // Same-day window (open < close). Overnight windows are uncommon for a trade
  // and intentionally unsupported (close treated as same-day).
  return cur >= open && cur < close;
}

/** Parse the raw jsonb `business_hours` column into a typed BusinessHours. */
export function parseBusinessHours(v: unknown): BusinessHours | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const days = Array.isArray(o.days) ? o.days.filter((d): d is number => typeof d === 'number' && d >= 1 && d <= 7) : [];
  const open = typeof o.open === 'string' && /^\d{2}:\d{2}$/.test(o.open) ? o.open : null;
  const close = typeof o.close === 'string' && /^\d{2}:\d{2}$/.test(o.close) ? o.close : null;
  if (days.length === 0 || !open || !close) return null;
  return { days, open, close };
}
