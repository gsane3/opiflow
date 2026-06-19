import { describe, it, expect } from 'vitest';
import { formatDateGr, formatDateTimeGr, formatRelativeDateTimeGr } from '../date';

describe('formatDateGr — DD-MM-YYYY', () => {
  it('formats a date-only string (YYYY-MM-DD)', () => {
    expect(formatDateGr('2026-06-09')).toBe('09-06-2026');
    expect(formatDateGr('2026-12-25')).toBe('25-12-2026');
  });

  it('zero-pads day and month', () => {
    expect(formatDateGr('2026-01-02')).toBe('02-01-2026');
    expect(formatDateGr('2026-09-05')).toBe('05-09-2026');
  });

  it('formats a local (non-Z) ISO timestamp by its date part', () => {
    expect(formatDateGr('2026-03-05T10:00:00')).toBe('05-03-2026');
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(formatDateGr(null)).toBe('');
    expect(formatDateGr(undefined)).toBe('');
    expect(formatDateGr('')).toBe('');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatDateGr('not-a-date')).toBe('');
    expect(formatDateGr('2026-13-40')).toBe('');
  });
});

describe('formatDateTimeGr — DD-MM-YYYY HH:MM', () => {
  it('appends zero-padded hours and minutes', () => {
    expect(formatDateTimeGr('2026-03-05T10:00:00')).toBe('05-03-2026 10:00');
    expect(formatDateTimeGr('2026-03-05T09:05:00')).toBe('05-03-2026 09:05');
  });

  it('returns empty string for null / undefined / empty', () => {
    expect(formatDateTimeGr(null)).toBe('');
    expect(formatDateTimeGr(undefined)).toBe('');
    expect(formatDateTimeGr('')).toBe('');
  });

  it('returns empty string for an invalid date', () => {
    expect(formatDateTimeGr('nope')).toBe('');
  });
});

describe('formatRelativeDateTimeGr — WhatsApp-style', () => {
  // Build local-time ISO strings relative to "now" so the test is timezone-stable.
  const at = (daysAgo: number, hh = 14, mm = 30) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hh, mm, 0, 0);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hh)}:${p(mm)}:00`;
  };
  const WEEKDAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

  it('shows "Σήμερα HH:MM" for today', () => {
    expect(formatRelativeDateTimeGr(at(0, 9, 5))).toBe('Σήμερα 09:05');
  });

  it('shows "Χθες HH:MM" for yesterday', () => {
    expect(formatRelativeDateTimeGr(at(1))).toBe('Χθες 14:30');
  });

  it('shows the Greek weekday + time for 2–6 days ago', () => {
    const iso = at(3);
    const expectedDay = WEEKDAYS[new Date(iso).getDay()];
    expect(formatRelativeDateTimeGr(iso)).toBe(`${expectedDay} 14:30`);
  });

  it('falls back to DD-MM-YYYY HH:MM once a week old', () => {
    const iso = at(8, 10, 0);
    expect(formatRelativeDateTimeGr(iso)).toBe(`${formatDateGr(iso)} 10:00`);
  });

  it('returns empty string for null / invalid input', () => {
    expect(formatRelativeDateTimeGr(null)).toBe('');
    expect(formatRelativeDateTimeGr('nope')).toBe('');
  });
});
