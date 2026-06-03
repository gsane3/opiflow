import { describe, it, expect } from 'vitest';
import { buildAppointmentIcs } from '../ics';

function lines(ics: string): string[] {
  return ics.split('\r\n');
}

describe('buildAppointmentIcs', () => {
  const base = {
    uid: 'evt-123',
    title: 'Meeting',
    date: '2026-06-15',
    time: '14:30',
  };

  it('uses CRLF line endings', () => {
    const ics = buildAppointmentIcs(base);
    expect(ics).toContain('\r\n');
    expect(ics).not.toMatch(/[^\r]\n/); // no bare LF
  });

  it('is wrapped in a VCALENDAR with required headers', () => {
    const ics = buildAppointmentIcs(base);
    const l = lines(ics);
    expect(l[0]).toBe('BEGIN:VCALENDAR');
    expect(l[l.length - 1]).toBe('END:VCALENDAR');
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('CALSCALE:GREGORIAN');
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('PRODID:');
  });

  it('contains a VEVENT with the provided UID and SUMMARY', () => {
    const ics = buildAppointmentIcs(base);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('UID:evt-123');
    expect(ics).toContain('SUMMARY:Meeting');
  });

  it('derives DTSTART from date + time as floating local time', () => {
    const ics = buildAppointmentIcs(base);
    // 2026-06-15 14:30 -> 20260615T143000 (no Z suffix = floating local)
    expect(ics).toContain('DTSTART:20260615T143000');
    expect(ics).not.toContain('DTSTART:20260615T143000Z');
  });

  it('computes DTEND using the default 60-minute duration', () => {
    const ics = buildAppointmentIcs(base);
    expect(ics).toContain('DTEND:20260615T153000');
  });

  it('honors a custom durationMinutes, including crossing the hour', () => {
    const ics = buildAppointmentIcs({ ...base, durationMinutes: 90 });
    // 14:30 + 90 min = 16:00
    expect(ics).toContain('DTEND:20260615T160000');
  });

  it('rolls DTEND over to the next day when the duration crosses midnight', () => {
    const ics = buildAppointmentIcs({
      ...base,
      time: '23:30',
      durationMinutes: 60,
    });
    expect(ics).toContain('DTSTART:20260615T233000');
    expect(ics).toContain('DTEND:20260616T003000');
  });

  it('zero-pads single-digit months, days, hours and minutes', () => {
    const ics = buildAppointmentIcs({
      ...base,
      date: '2026-01-05',
      time: '09:05',
    });
    expect(ics).toContain('DTSTART:20260105T090500');
  });

  it('emits a DTSTAMP in UTC form (ends with Z)', () => {
    const ics = buildAppointmentIcs(base);
    const stamp = lines(ics).find((l) => l.startsWith('DTSTAMP:'));
    expect(stamp).toBeDefined();
    expect(stamp).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  });

  it('always includes a 1-hour-before VALARM block', () => {
    const ics = buildAppointmentIcs(base);
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT1H');
    expect(ics).toContain('ACTION:DISPLAY');
    expect(ics).toContain('END:VALARM');
  });

  it('omits DESCRIPTION and LOCATION when not provided', () => {
    const ics = buildAppointmentIcs(base);
    // The only DESCRIPTION present should be the VALARM reminder one.
    const descLines = lines(ics).filter((l) => l.startsWith('DESCRIPTION:'));
    expect(descLines).toHaveLength(1); // VALARM reminder only
    expect(ics).not.toContain('LOCATION:');
  });

  it('includes DESCRIPTION and LOCATION when provided', () => {
    const ics = buildAppointmentIcs({
      ...base,
      description: 'Discuss roof repair',
      location: 'Athens',
    });
    expect(ics).toContain('DESCRIPTION:Discuss roof repair');
    expect(ics).toContain('LOCATION:Athens');
  });

  it('escapes backslashes, commas, semicolons and newlines per RFC 5545', () => {
    const ics = buildAppointmentIcs({
      ...base,
      title: 'A; B, C\\D\nE',
    });
    expect(ics).toContain('SUMMARY:A\\; B\\, C\\\\D\\nE');
  });

  it('escapes special characters inside DESCRIPTION too', () => {
    const ics = buildAppointmentIcs({
      ...base,
      description: 'line1\nline2; end',
    });
    expect(ics).toContain('DESCRIPTION:line1\\nline2\\; end');
  });
});
