'use client';

// Telephony settings: per-user availability (presence) + the A/B onboarding
// model for the user's existing number. Self-contained — fetches and saves via
// /api/phone/presence and /api/phone/telephony. Degrades quietly if migration
// 031 has not been applied yet (the endpoints return degraded:true).

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type Mode = 'native' | 'forward';
type Presence = 'available' | 'busy' | 'away' | 'dnd' | 'offline';

const PRESENCE: { key: Presence; label: string; dot: string }[] = [
  { key: 'available', label: 'Διαθέσιμος', dot: 'bg-emerald-500' },
  { key: 'busy', label: 'Σε κλήση', dot: 'bg-amber-500' },
  { key: 'away', label: 'Λείπω', dot: 'bg-zinc-400' },
  { key: 'dnd', label: 'Μην ενοχλείτε', dot: 'bg-red-500' },
  { key: 'offline', label: 'Εκτός', dot: 'bg-zinc-300' },
];

async function getToken(): Promise<string | null> {
  const supabase = createBrowserSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function TelephonyPanel({ businessPhoneNumber }: { businessPhoneNumber: string | null }) {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode | null>(null);
  const [srcNumber, setSrcNumber] = useState('');
  const [presence, setPresence] = useState<Presence>('available');
  const [savingMode, setSavingMode] = useState(false);
  const [modeMsg, setModeMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [tRes, pRes] = await Promise.all([
          fetch('/api/phone/telephony', { headers }),
          fetch('/api/phone/presence', { headers }),
        ]);
        const t = await tRes.json().catch(() => ({}));
        const p = await pRes.json().catch(() => ({}));
        if (cancelled) return;
        if (t?.ok) {
          if (t.mode === 'native' || t.mode === 'forward') setMode(t.mode);
          if (typeof t.forwardingSourceNumber === 'string') setSrcNumber(t.forwardingSourceNumber);
        }
        if (p?.ok && typeof p.status === 'string') setPresence(p.status as Presence);
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveMode = useCallback(
    async (nextMode: Mode) => {
      setMode(nextMode);
      setModeMsg(null);
      setSavingMode(true);
      try {
        const token = await getToken();
        if (!token) {
          setModeMsg({ tone: 'err', text: 'Πρέπει να είσαι συνδεδεμένος.' });
          return;
        }
        const res = await fetch('/api/phone/telephony', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mode: nextMode, forwardingSourceNumber: nextMode === 'forward' ? srcNumber : null }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.ok) {
          setModeMsg({ tone: 'ok', text: 'Αποθηκεύτηκε.' });
        } else if (json?.degraded) {
          setModeMsg({ tone: 'err', text: 'Δεν είναι ακόμα διαθέσιμο (εκκρεμεί ρύθμιση συστήματος).' });
        } else {
          setModeMsg({ tone: 'err', text: 'Η αποθήκευση απέτυχε.' });
        }
      } catch {
        setModeMsg({ tone: 'err', text: 'Η αποθήκευση απέτυχε.' });
      } finally {
        setSavingMode(false);
      }
    },
    [srcNumber]
  );

  const savePresence = useCallback(async (next: Presence) => {
    setPresence(next);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch('/api/phone/presence', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      /* non-fatal; UI already reflects the choice */
    }
  }, []);

  return (
    <div className="mt-4 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
      <p className="text-sm font-semibold text-zinc-900">Τηλεφωνία</p>

      {/* Presence */}
      <div className="mt-3">
        <p className="text-xs font-medium text-zinc-500">Διαθεσιμότητα</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESENCE.map((p) => {
            const active = presence === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => savePresence(p.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                  active ? 'bg-indigo-50 text-indigo-700 ring-indigo-200' : 'bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-400">
          Όταν δεν είσαι «Διαθέσιμος», οι εισερχόμενες προωθούνται σε AI/φωνητικό και κρατούν task για επιστροφή κλήσης.
        </p>
      </div>

      {/* Onboarding model A/B */}
      <div className="mt-5 border-t border-zinc-100 pt-4">
        <p className="text-xs font-medium text-zinc-500">Πώς θες να δέχεσαι κλήσεις;</p>
        {loading ? (
          <p className="mt-2 text-xs text-zinc-400">Φόρτωση...</p>
        ) : (
          <div className="mt-2 space-y-2">
            <ModeCard
              active={mode === 'native'}
              disabled={savingMode}
              title="Μόνο το νούμερο Opiflow"
              desc="Χρησιμοποιείς αποκλειστικά τον αριθμό που σου δίνει το Opiflow. Πιο καθαρό — όλα περνούν από την εφαρμογή."
              onClick={() => saveMode('native')}
            />
            <ModeCard
              active={mode === 'forward'}
              disabled={savingMode}
              title="Κρατάω το νούμερό μου"
              desc="Κρατάς το δικό σου νούμερο και βάζεις προώθηση προς το Opiflow. Χωρίς φορητότητα."
              onClick={() => saveMode('forward')}
            />

            {mode === 'forward' && (
              <div className="rounded-2xl bg-zinc-50 px-4 py-3">
                <label className="block text-xs font-medium text-zinc-600">Το δικό σου νούμερο</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={srcNumber}
                    onChange={(e) => setSrcNumber(e.target.value)}
                    inputMode="tel"
                    placeholder="π.χ. 69XXXXXXXX"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    disabled={savingMode}
                    onClick={() => saveMode('forward')}
                    className="shrink-0 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Αποθήκευση
                  </button>
                </div>
                {businessPhoneNumber ? (
                  <div className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                    <p className="font-medium text-zinc-600">Ρύθμισε προώθηση προς {businessPhoneNumber}:</p>
                    <p className="mt-1">
                      • Ενεργοποίηση: κάλεσε <code className="rounded bg-white px-1 py-0.5 ring-1 ring-zinc-200">**21*{businessPhoneNumber}#</code>
                    </p>
                    <p>
                      • Απενεργοποίηση: κάλεσε <code className="rounded bg-white px-1 py-0.5 ring-1 ring-zinc-200">##21#</code>
                    </p>
                    <p className="mt-1 text-zinc-400">
                      Οι κωδικοί μπορεί να διαφέρουν ανά πάροχο (Cosmote/Vodafone/Nova) — επιβεβαίωσε με τον δικό σου.
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Μόλις σου ανατεθεί αριθμός Opiflow θα εμφανιστούν εδώ οι οδηγίες προώθησης.
                  </p>
                )}
              </div>
            )}

            {modeMsg && (
              <p className={`text-xs ${modeMsg.tone === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>{modeMsg.text}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ModeCard({
  active,
  disabled,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full rounded-2xl px-4 py-3 text-left ring-1 transition disabled:opacity-60 ${
        active ? 'bg-indigo-50 ring-indigo-300' : 'bg-white ring-zinc-200 hover:bg-zinc-50'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ${
            active ? 'bg-indigo-600 ring-indigo-600' : 'bg-white ring-zinc-300'
          }`}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
        <span className="text-sm font-semibold text-zinc-900">{title}</span>
      </div>
      <p className="mt-1 pl-6 text-xs leading-relaxed text-zinc-500">{desc}</p>
    </button>
  );
}
