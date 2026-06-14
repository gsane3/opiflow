'use client';

// Ωράριο & αυτοματισμοί: business hours + after-hours auto-reply + weekly summary.
// Backed by /api/businesses/me/messaging-settings (migration 044, tolerant of
// pre-migration state).

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/ui/Spinner';

interface BusinessHours { days: number[]; open: string; close: string }
interface Settings {
  businessHours: BusinessHours | null;
  autoReplyEnabled: boolean;
  autoReplyText: string | null;
  weeklySummaryEnabled: boolean;
}

const DAYS: Array<{ n: number; label: string }> = [
  { n: 1, label: 'Δε' }, { n: 2, label: 'Τρ' }, { n: 3, label: 'Τε' },
  { n: 4, label: 'Πε' }, { n: 5, label: 'Πα' }, { n: 6, label: 'Σα' }, { n: 7, label: 'Κυ' },
];

const DEFAULT_AUTO_REPLY = 'Γεια σας! Λάβαμε την κλήση σας εκτός ωραρίου. Θα σας καλέσουμε το συντομότερο δυνατό. Ευχαριστούμε!';

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
  } catch {
    return null;
  }
}

export default function AutomationsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [open, setOpen] = useState('09:00');
  const [close, setClose] = useState('18:00');
  const [hoursEnabled, setHoursEnabled] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyText, setAutoReplyText] = useState(DEFAULT_AUTO_REPLY);
  const [weeklyEnabled, setWeeklyEnabled] = useState(true);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); setLoading(false); return; }
    try {
      const res = await fetch('/api/businesses/me/messaging-settings', { headers });
      const json = await res.json().catch(() => ({}));
      const s = json?.settings as Settings | undefined;
      if (s) {
        if (s.businessHours) {
          setHoursEnabled(true);
          setDays(s.businessHours.days);
          setOpen(s.businessHours.open);
          setClose(s.businessHours.close);
        }
        setAutoReplyEnabled(s.autoReplyEnabled);
        if (s.autoReplyText) setAutoReplyText(s.autoReplyText);
        setWeeklyEnabled(s.weeklySummaryEnabled);
      }
    } catch {
      setError('Δεν φορτώθηκαν οι ρυθμίσεις.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    const headers = await authHeaders();
    if (!headers) return;
    setSaving(true); setSaved(false); setError(null);
    try {
      const res = await fetch('/api/businesses/me/messaging-settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          businessHours: hoursEnabled && days.length > 0 ? { days, open, close } : null,
          autoReplyEnabled,
          autoReplyText: autoReplyText.trim() || null,
          weeklySummaryEnabled: weeklyEnabled,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (json?.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
      else setError(json?.hint === 'migration_044_pending' ? 'Η βάση δεδομένων δεν είναι ακόμη έτοιμη γι’ αυτό.' : 'Η αποθήκευση απέτυχε.');
    } catch {
      setError('Η αποθήκευση απέτυχε.');
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(n: number) {
    setDays((prev) => (prev.includes(n) ? prev.filter((d) => d !== n) : [...prev, n].sort()));
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner className="text-indigo-500" /></div>;

  return (
    <div className="space-y-4">
      {/* After-hours auto-reply */}
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <label className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Αυτόματη απάντηση σε αναπάντητη</span>
            <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">Όταν χάνεις κλήση εκτός ωραρίου, ο πελάτης λαμβάνει αυτόματο μήνυμα (Viber → SMS).</span>
          </span>
          <input type="checkbox" checked={autoReplyEnabled} onChange={(e) => setAutoReplyEnabled(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-indigo-600" />
        </label>
        {autoReplyEnabled && (
          <textarea
            value={autoReplyText}
            onChange={(e) => setAutoReplyText(e.target.value)}
            rows={3}
            maxLength={600}
            className="mt-3 w-full resize-none rounded-xl bg-zinc-100 dark:bg-[#1e2b38] px-3.5 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200"
          />
        )}
      </div>

      {/* Business hours */}
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <label className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Ωράριο λειτουργίας</span>
            <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">Καθορίζει πότε θεωρείται «εκτός ωραρίου» για την αυτόματη απάντηση. Χωρίς ωράριο, η απάντηση στέλνεται σε κάθε αναπάντητη.</span>
          </span>
          <input type="checkbox" checked={hoursEnabled} onChange={(e) => setHoursEnabled(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-indigo-600" />
        </label>
        {hoursEnabled && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d) => (
                <button
                  key={d.n}
                  type="button"
                  onClick={() => toggleDay(d.n)}
                  className={`h-9 w-9 rounded-full text-xs font-semibold transition ${days.includes(d.n) ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-[#1e2b38] text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-white/5'}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input type="time" value={open} onChange={(e) => setOpen(e.target.value)} className="rounded-xl bg-zinc-100 dark:bg-[#1e2b38] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200" />
              <span className="text-sm text-zinc-400 dark:text-zinc-500">έως</span>
              <input type="time" value={close} onChange={(e) => setClose(e.target.value)} className="rounded-xl bg-zinc-100 dark:bg-[#1e2b38] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:bg-white dark:focus:bg-[#0f1923] focus:ring-2 focus:ring-indigo-200" />
            </div>
          </div>
        )}
      </div>

      {/* Weekly summary */}
      <div className="rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
        <label className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">Εβδομαδιαία σύνοψη</span>
            <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">Μία ειδοποίηση τη βδομάδα: κλήσεις, αναπάντητες, εκκρεμότητες.</span>
          </span>
          <input type="checkbox" checked={weeklyEnabled} onChange={(e) => setWeeklyEnabled(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-indigo-600" />
        </label>
      </div>

      {error && <p className="px-1 text-xs text-red-500">{error}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving}
        className="flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition active:scale-95 enabled:hover:bg-indigo-700 disabled:opacity-40"
      >
        {saving && <Spinner className="text-white" />}
        {saved ? 'Αποθηκεύτηκε ✓' : 'Αποθήκευση'}
      </button>
    </div>
  );
}
