'use client';

// Inline appointment response for the public portal: «Επιβεβαίωση» (accept) and
// «Αλλαγή ώρας» (request a ±60-min slot). POSTs to the folder-scoped endpoint
// (the folder token is the credential). The server re-validates the exact ±60
// rule, so the options computed here are only a convenience.

import { useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

function shift(date: string, time: string, deltaHours: number): { date: string; time: string } | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const base = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  const d = new Date(base + deltaHours * 3600 * 1000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

export default function AppointmentRespond({
  token,
  taskId,
  date,
  time,
}: {
  token: string;
  taskId: string;
  date: string | null;
  time: string | null;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'confirmed' | 'changeRequested' | 'error'>('idle');
  const [showChange, setShowChange] = useState(false);

  async function post(body: Record<string, unknown>, onOk: 'confirmed' | 'changeRequested') {
    setState('busy');
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/appointment/${taskId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setState(res.ok && json?.ok ? onOk : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'confirmed') {
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-green-700">
        <span aria-hidden>✓</span> Επιβεβαιώθηκε
      </p>
    );
  }
  if (state === 'changeRequested') {
    return <p className="mt-2 text-sm font-medium text-zinc-600">Ζητήσατε αλλαγή ώρας — θα σας ενημερώσουμε.</p>;
  }

  const options = date && time ? [shift(date, time, -1), shift(date, time, 1)].filter(Boolean) : [];

  return (
    <div className="mt-2">
      {!showChange ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void post({ response: 'accepted' }, 'confirmed')}
            disabled={state === 'busy'}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
          >
            {state === 'busy' ? 'Γίνεται…' : 'Επιβεβαίωση'}
          </button>
          {options.length > 0 && (
            <button
              type="button"
              onClick={() => setShowChange(true)}
              disabled={state === 'busy'}
              className="rounded-xl border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
            >
              Αλλαγή ώρας
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs text-zinc-500">Προτεινόμενες ώρες:</p>
          <div className="flex flex-wrap gap-2">
            {options.map(
              (o) =>
                o && (
                  <button
                    key={`${o.date} ${o.time}`}
                    type="button"
                    onClick={() =>
                      void post(
                        { response: 'time_change_requested', requestedDueDate: o.date, requestedDueTime: o.time },
                        'changeRequested',
                      )
                    }
                    disabled={state === 'busy'}
                    className="rounded-xl border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                  >
                    {o.time}
                    {o.date !== date ? ` (${o.date.slice(8, 10)}-${o.date.slice(5, 7)})` : ''}
                  </button>
                ),
            )}
            <button
              type="button"
              onClick={() => setShowChange(false)}
              className="rounded-xl px-3 py-2 text-sm text-zinc-500 transition hover:text-zinc-800"
            >
              Άκυρο
            </button>
          </div>
        </div>
      )}
      {state === 'error' && (
        <p className="mt-1 text-xs text-red-600">Κάτι πήγε στραβά. Δοκιμάστε ξανά ή στείλτε μας μήνυμα πιο κάτω.</p>
      )}
    </div>
  );
}
