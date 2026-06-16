// Pure appointment(task)-status helpers — NO runtime deps (no Supabase/push), so
// the public-folder read path + unit tests can use them without pulling
// server-only modules. Mirrors the offer-status split.

import { isBeforeToday } from './offer-status';

export { isBeforeToday };

// Task types that represent a customer appointment (the only ones the public
// appointment flow may act on). Reused tasks of other types are off-limits.
export const APPOINTMENT_TYPES = ['book_appointment', 'visit_customer'] as const;
export const FINAL_TASK_STATUSES = ['completed', 'cancelled'] as const;

/** Whether the customer can still respond to this appointment (right type, not
 *  final, has a future-or-today date). */
export function appointmentCanRespond(task: {
  status: string;
  type: string;
  due_date: string | null;
}): boolean {
  if ((FINAL_TASK_STATUSES as readonly string[]).includes(task.status)) return false;
  if (!(APPOINTMENT_TYPES as readonly string[]).includes(task.type)) return false;
  if (!task.due_date) return false;
  if (isBeforeToday(task.due_date)) return false;
  return true;
}

// ---- ±60-minute reschedule math (UTC, date-only + HH:mm) — pure, testable ----

function parseTaskDateTime(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  return new Date(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0));
}
function fmtDateUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function fmtTimeUTC(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** The exactly-±60-minute reschedule options for a base slot (earlier, later).
 *  Empty if the slot can't be parsed. Used by the server validation AND mirrored
 *  by the portal UI; keeping it here (pure) keeps both in sync + unit-testable. */
export function timeChangeOptions(date: string, time: string): { date: string; time: string }[] {
  const base = parseTaskDateTime(date, time);
  if (!base) return [];
  const H = 60 * 60 * 1000;
  return [new Date(base.getTime() - H), new Date(base.getTime() + H)].map((d) => ({
    date: fmtDateUTC(d),
    time: fmtTimeUTC(d),
  }));
}
