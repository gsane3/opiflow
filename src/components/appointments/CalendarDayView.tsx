'use client';

// Google-calendar-style day view for appointments: a week strip to pick a day,
// then the chosen day's appointments laid out by hour. Read-only positioning;
// tapping an appointment opens the same detail flow as the list view.

import { useMemo, useState } from 'react';
import type { Task } from '@/lib/types';

const WD_SHORT = ['Κυ', 'Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα']; // getDay(): 0 = Sunday
const WD_LONG = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MONTHS = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 07:00 … 21:00

export default function CalendarDayView({
  appointments,
  customerName,
  onSelect,
}: {
  appointments: Task[];
  customerName: (id?: string | null) => string | undefined;
  onSelect: (t: Task) => void;
}) {
  const todayStr = ymd(new Date());
  const [selected, setSelected] = useState(todayStr);

  // The Monday-first week containing the selected day.
  const weekDays = useMemo(() => {
    const d = new Date(selected + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(monday);
      x.setDate(monday.getDate() + i);
      return x;
    });
  }, [selected]);

  const countFor = (s: string) => appointments.filter((a) => a.dueDate === s).length;

  const dayAppts = useMemo(
    () => appointments.filter((a) => a.dueDate === selected),
    [appointments, selected],
  );
  const apptHour = (t: Task) => parseInt((t.dueTime ?? '').split(':')[0] || '-1', 10);
  const timed = dayAppts
    .filter((a) => !!a.dueTime)
    .sort((a, b) => (a.dueTime ?? '').localeCompare(b.dueTime ?? ''));
  const within = timed.filter((t) => apptHour(t) >= 7 && apptHour(t) <= 21);
  const overflow = [
    ...dayAppts.filter((a) => !a.dueTime),
    ...timed.filter((t) => apptHour(t) < 7 || apptHour(t) > 21),
  ];

  const shiftWeek = (delta: number) => {
    const d = new Date(selected + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    setSelected(ymd(d));
  };

  const selDate = new Date(selected + 'T00:00:00');
  const headerLabel = `${WD_LONG[selDate.getDay()]} ${selDate.getDate()} ${MONTHS[selDate.getMonth()]}`;

  const Block = ({ task }: { task: Task }) => {
    const name = customerName(task.customerId);
    return (
      <button
        type="button"
        onClick={() => onSelect(task)}
        className="w-full rounded-2xl border-l-4 border-indigo-500 bg-indigo-50/80 px-3 py-2 text-left transition hover:bg-indigo-100 active:scale-[0.99] dark:bg-indigo-500/15 dark:hover:bg-indigo-500/25"
      >
        <div className="flex items-center gap-2">
          {task.dueTime && (
            <span className="text-xs font-bold tabular-nums text-indigo-700 dark:text-indigo-300">{task.dueTime}</span>
          )}
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{task.title}</span>
        </div>
        {name && <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{name}</p>}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* Week navigator */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          aria-label="Προηγούμενη εβδομάδα"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-500 ring-1 ring-zinc-200/60 transition hover:bg-zinc-50 dark:bg-[#17232f] dark:text-zinc-400 dark:ring-white/10"
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </button>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{headerLabel}</p>
        <button
          type="button"
          onClick={() => shiftWeek(1)}
          aria-label="Επόμενη εβδομάδα"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-500 ring-1 ring-zinc-200/60 transition hover:bg-zinc-50 dark:bg-[#17232f] dark:text-zinc-400 dark:ring-white/10"
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={2.2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        </button>
      </div>

      {/* Day chips */}
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((d) => {
          const s = ymd(d);
          const isSel = s === selected;
          const isToday = s === todayStr;
          const n = countFor(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSelected(s)}
              className={`flex flex-col items-center gap-0.5 rounded-2xl py-2 transition ${
                isSel
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : `bg-white text-zinc-700 ring-1 ring-zinc-200/60 hover:bg-zinc-50 dark:bg-[#17232f] dark:text-zinc-200 dark:ring-white/10 ${isToday ? 'ring-indigo-300 dark:ring-indigo-500/50' : ''}`
              }`}
            >
              <span className={`text-[10px] ${isSel ? 'text-white/80' : 'text-zinc-400 dark:text-zinc-500'}`}>{WD_SHORT[d.getDay()]}</span>
              <span className="text-base font-bold leading-none">{d.getDate()}</span>
              <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${n > 0 ? (isSel ? 'bg-white' : 'bg-indigo-500') : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>

      {selected !== todayStr && (
        <button type="button" onClick={() => setSelected(todayStr)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
          → Σήμερα
        </button>
      )}

      {/* All-day / out-of-window appointments */}
      {overflow.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Χωρίς ώρα</p>
          {overflow.map((t) => <Block key={t.id} task={t} />)}
        </div>
      )}

      {/* Hour grid */}
      <div className="overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
        {HOURS.map((h) => {
          const items = within.filter((t) => apptHour(t) === h);
          return (
            <div key={h} className="flex min-h-[44px] gap-3 border-b border-zinc-100 px-4 py-1.5 last:border-b-0 dark:border-white/10">
              <span className="w-11 shrink-0 pt-1.5 text-xs tabular-nums text-zinc-400 dark:text-zinc-500">{pad(h)}:00</span>
              <div className="flex-1 space-y-1.5 py-0.5">
                {items.map((t) => <Block key={t.id} task={t} />)}
              </div>
            </div>
          );
        })}
      </div>

      {dayAppts.length === 0 && (
        <p className="py-3 text-center text-sm text-zinc-400 dark:text-zinc-500">Δεν υπάρχουν ραντεβού αυτή τη μέρα.</p>
      )}
    </div>
  );
}
