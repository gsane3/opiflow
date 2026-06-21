'use client';

// Telephony settings: per-user availability (presence) + the A/B onboarding
// model for the user's existing number. Self-contained — fetches and saves via
// /api/phone/presence and /api/phone/telephony. Degrades quietly if migration
// 031 has not been applied yet (the endpoints return degraded:true).

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import DisclosureRecorder from '@/components/onboarding/DisclosureRecorder';

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
  // Call recording (auto-on) + mic permission — moved here from the Κλήσεις screen.
  // The preference is now persisted per-business via /api/phone/recording (the
  // outbound TwiML webhook reads it); localStorage is kept as a client-side mirror
  // so the browser calling screen's recording gate stays in sync on this device.
  const [recordCalls, setRecordCalls] = useState(true);
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordMsg, setRecordMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [micState, setMicState] = useState<'unknown' | 'checking' | 'granted' | 'denied' | 'unsupported'>('unknown');
  const [micError, setMicError] = useState<string | null>(null);
  // Per-business call-recording disclosure clip, recorded in the user's own voice.
  const [disclosureAudio, setDisclosureAudio] = useState('');
  const [disclosureReady, setDisclosureReady] = useState(false);
  const [disclosureSaving, setDisclosureSaving] = useState(false);
  const [disclosureMsg, setDisclosureMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

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

  // Load the record-calls preference from the server (the source of truth the
  // outbound webhook reads), mirroring it into localStorage for the browser
  // calling screen. Falls back to the localStorage mirror when offline / signed out.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let on = true;
      try { on = localStorage.getItem('deskop_record_calls') !== '0'; } catch { /* ignore */ }
      try {
        const token = await getToken();
        if (token) {
          const res = await fetch('/api/phone/recording', { headers: { Authorization: `Bearer ${token}` } });
          const j = await res.json().catch(() => ({}));
          if (j?.ok && typeof j.recordCalls === 'boolean') {
            on = j.recordCalls;
            try { localStorage.setItem('deskop_record_calls', on ? '1' : '0'); } catch { /* ignore */ }
          }
        }
      } catch { /* keep the localStorage fallback */ }
      if (!cancelled) setRecordCalls(on);
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist the preference server-side (PUT) instead of localStorage-only. Optimistic;
  // mirrors the choice into localStorage so the browser calling screen reflects it
  // immediately, and reverts the toggle if the save genuinely fails.
  async function setRecording(next: boolean) {
    const prev = recordCalls;
    setRecordCalls(next);
    setRecordMsg(null);
    setRecordSaving(true);
    const mirror = (v: boolean) => { try { localStorage.setItem('deskop_record_calls', v ? '1' : '0'); } catch { /* ignore */ } };
    mirror(next);
    try {
      const token = await getToken();
      if (!token) {
        setRecordMsg({ tone: 'err', text: 'Πρέπει να είσαι συνδεδεμένος.' });
        setRecordCalls(prev);
        mirror(prev);
        return;
      }
      const res = await fetch('/api/phone/recording', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ recordCalls: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (j?.ok) {
        setRecordMsg({ tone: 'ok', text: 'Αποθηκεύτηκε.' });
      } else if (j?.error === 'migration_pending' || j?.degraded) {
        // DB column not there yet — the choice is honoured by the browser gate
        // (localStorage) but won't reach server-side recording until 059 lands.
        setRecordMsg({ tone: 'err', text: 'Δεν είναι ακόμα διαθέσιμο (εκκρεμεί ρύθμιση συστήματος).' });
      } else {
        setRecordMsg({ tone: 'err', text: 'Η αποθήκευση απέτυχε.' });
        setRecordCalls(prev);
        mirror(prev);
      }
    } catch {
      setRecordMsg({ tone: 'err', text: 'Η αποθήκευση απέτυχε.' });
      setRecordCalls(prev);
      mirror(prev);
    } finally {
      setRecordSaving(false);
    }
  }

  // Load the saved disclosure clip on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) { if (!cancelled) setDisclosureReady(true); return; }
      try {
        const res = await fetch('/api/businesses/me/disclosure-audio', { headers: { Authorization: `Bearer ${token}` } });
        const j = await res.json().catch(() => ({}));
        if (!cancelled && j?.ok && typeof j.audio === 'string') setDisclosureAudio(j.audio);
      } catch { /* keep empty */ } finally { if (!cancelled) setDisclosureReady(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  async function saveDisclosure(dataUrl: string) {
    const prev = disclosureAudio;
    setDisclosureAudio(dataUrl);
    setDisclosureSaving(true);
    setDisclosureMsg(null);
    try {
      const token = await getToken();
      if (!token) { setDisclosureMsg({ tone: 'err', text: 'Πρέπει να είσαι συνδεδεμένος.' }); setDisclosureAudio(prev); return; }
      const res = await fetch('/api/businesses/me/disclosure-audio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ audio: dataUrl || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) setDisclosureMsg({ tone: 'ok', text: dataUrl ? 'Αποθηκεύτηκε.' : 'Αφαιρέθηκε.' });
      else if (j?.error === 'migration_pending') { setDisclosureMsg({ tone: 'err', text: 'Δεν είναι ακόμα διαθέσιμο (εκκρεμεί ρύθμιση συστήματος).' }); setDisclosureAudio(prev); }
      else { setDisclosureMsg({ tone: 'err', text: 'Η αποθήκευση απέτυχε.' }); setDisclosureAudio(prev); }
    } catch { setDisclosureMsg({ tone: 'err', text: 'Η αποθήκευση απέτυχε.' }); setDisclosureAudio(prev); }
    finally { setDisclosureSaving(false); }
  }

  async function checkMic() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      setMicState('unsupported');
      return;
    }
    setMicState('checking');
    setMicError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicState('granted');
    } catch {
      setMicState('denied');
      setMicError('Δεν δόθηκε άδεια μικροφώνου. Ενεργοποίησέ την από τον browser.');
    }
  }

  return (
    <div className="mt-4 rounded-[28px] bg-white dark:bg-[#17232f] px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Τηλεφωνία</p>

      {/* Call recording (auto-on) + microphone */}
      <div className="mt-3 border-b border-zinc-100 dark:border-white/10 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Ηχογράφηση κλήσεων</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Αυτόματη μεταγραφή &amp; AI brief. Ενεργή από προεπιλογή. Ενημέρωνε τον πελάτη ότι ηχογραφείται.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={recordCalls}
            aria-label="Ηχογράφηση κλήσεων"
            disabled={recordSaving}
            onClick={() => setRecording(!recordCalls)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${recordCalls ? 'bg-indigo-600' : 'bg-zinc-200 dark:bg-white/10'}`}
          >
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${recordCalls ? 'translate-x-[20px]' : 'translate-x-0'}`} />
          </button>
        </div>
        {recordMsg && (
          <p className={`mt-2 text-xs ${recordMsg.tone === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>{recordMsg.text}</p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Μικρόφωνο</p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {micState === 'granted' ? (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  Άδεια δόθηκε
                  <svg className="h-3.5 w-3.5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                </span>
              ) : micState === 'denied'
                ? (micError ?? 'Δεν δόθηκε άδεια. Ενεργοποίησέ την από τον browser.')
                : micState === 'unsupported'
                ? 'Ο browser δεν υποστηρίζει έλεγχο εδώ.'
                : 'Χρειάζεται άδεια για κλήσεις μέσα από την εφαρμογή.'}
            </p>
          </div>
          {micState !== 'granted' && micState !== 'unsupported' && (
            <Button
              type="button"
              size="sm"
              onClick={checkMic}
              disabled={micState === 'checking'}
              loading={micState === 'checking'}
              className="shrink-0"
            >
              {micState === 'checking' ? 'Έλεγχος…' : 'Έλεγχος'}
            </Button>
          )}
        </div>

        {/* Disclosure recording — the user's own-voice "η κλήση ηχογραφείται" message */}
        <div className="mt-4 border-t border-zinc-100 dark:border-white/10 pt-4">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Μήνυμα ηχογράφησης (η φωνή σου)</p>
          <p className="mt-0.5 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Ακούγεται στον πελάτη πριν μιλήσετε, σε κάθε κλήση. Αν δεν ηχογραφήσεις, παίζει τυποποιημένο μήνυμα.
          </p>
          {disclosureReady ? (
            <DisclosureRecorder value={disclosureAudio} onChange={saveDisclosure} saving={disclosureSaving} />
          ) : (
            <div className="flex items-center gap-2"><Spinner size="sm" className="text-indigo-500" /><span className="text-xs text-zinc-500 dark:text-zinc-400">Φόρτωση…</span></div>
          )}
          {disclosureMsg && (
            <p className={`mt-2 text-xs ${disclosureMsg.tone === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>{disclosureMsg.text}</p>
          )}
        </div>
      </div>

      {/* Presence */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Διαθεσιμότητα</p>
          <span className="rounded-full bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 ring-1 ring-amber-200 dark:ring-amber-500/20">
            Σύντομα
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESENCE.map((p) => {
            const active = presence === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => savePresence(p.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                  active ? 'bg-indigo-50 text-indigo-700 ring-indigo-200' : 'bg-white dark:bg-[#17232f] text-zinc-600 dark:text-zinc-300 ring-zinc-200 dark:ring-white/10 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          Η διαθεσιμότητά σου αποθηκεύεται. Η αυτόματη δρομολόγηση εισερχομένων (AI/φωνητικό &amp; επιστροφή κλήσης όταν δεν είσαι διαθέσιμος) έρχεται σύντομα.
        </p>
      </div>

      {/* Onboarding model A/B */}
      <div className="mt-5 border-t border-zinc-100 dark:border-white/10 pt-4">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Πώς θες να δέχεσαι κλήσεις;</p>
        {loading ? (
          <div className="mt-2 flex items-center gap-2">
            <Spinner size="sm" className="text-indigo-500" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Φόρτωση…</span>
          </div>
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
              <div className="rounded-2xl bg-zinc-50 dark:bg-[#1e2b38] px-4 py-3">
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">Το δικό σου νούμερο</label>
                <div className="mt-1.5 flex gap-2">
                  <input
                    value={srcNumber}
                    onChange={(e) => setSrcNumber(e.target.value)}
                    inputMode="tel"
                    placeholder="π.χ. 69XXXXXXXX"
                    className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-4 py-2.5 text-base tabular-nums text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={savingMode}
                    loading={savingMode}
                    onClick={() => saveMode('forward')}
                    className="shrink-0"
                  >
                    Αποθήκευση
                  </Button>
                </div>
                {businessPhoneNumber ? (
                  <div className="mt-3 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    <p className="font-medium text-zinc-600 dark:text-zinc-300">Ρύθμισε προώθηση προς {businessPhoneNumber}:</p>
                    <p className="mt-1">
                      • Ενεργοποίηση: κάλεσε <code className="rounded bg-white dark:bg-[#17232f] px-1 py-0.5 ring-1 ring-zinc-200 dark:ring-white/10">**21*{businessPhoneNumber}#</code>
                    </p>
                    <p>
                      • Απενεργοποίηση: κάλεσε <code className="rounded bg-white dark:bg-[#17232f] px-1 py-0.5 ring-1 ring-zinc-200 dark:ring-white/10">##21#</code>
                    </p>
                    <p className="mt-1 text-zinc-400 dark:text-zinc-500">
                      Οι κωδικοί μπορεί να διαφέρουν ανά πάροχο (Cosmote/Vodafone/Nova) — επιβεβαίωσε με τον δικό σου.
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                    Μόλις σου ανατεθεί αριθμός Opiflow θα εμφανιστούν εδώ οι οδηγίες προώθησης.
                  </p>
                )}
              </div>
            )}

            {modeMsg && (
              <p className={`flex items-center gap-1 text-xs motion-safe:animate-[fadeIn_0.2s] ${modeMsg.tone === 'ok' ? 'text-emerald-600' : 'text-amber-600'}`}>
                {modeMsg.tone === 'ok' && (
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                )}
                {modeMsg.text}
              </p>
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
        active ? 'bg-indigo-50 ring-indigo-200' : 'bg-white dark:bg-[#17232f] ring-zinc-200 dark:ring-white/10 hover:bg-zinc-50 dark:hover:bg-white/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ring-1 ${
            active ? 'bg-indigo-600 ring-indigo-600' : 'bg-white dark:bg-[#17232f] ring-zinc-300 dark:ring-white/10'
          }`}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
        </span>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
      </div>
      <p className="mt-1 pl-6 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{desc}</p>
    </button>
  );
}
