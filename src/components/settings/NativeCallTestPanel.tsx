'use client';

// Settings → native call test (Twilio Voice).
//
// An isolated, NATIVE-ONLY panel to validate the whole outbound chain —
// app (Twilio Voice SDK) → Twilio → Asterisk (from-twilio) → InterTelecom →
// the Greek customer — without touching the production browser jsSIP path.
// Renders nothing on the web. Visible only once the native plugin is present
// (i.e. a Codemagic build that bundled @capgo/capacitor-twilio-voice) AND a
// Twilio token is mintable (TWILIO_* env set).

import { useEffect, useRef, useState } from 'react';
import {
  isNativeVoiceAvailable,
  initNativeVoice,
  placeNativeCall,
  endNativeCall,
} from '@/lib/native/twilio-voice';

type Reg = 'checking' | 'web' | 'registering' | 'registered' | 'failed' | 'no_token';
type Call = 'idle' | 'dialing' | 'ringing' | 'connected' | 'ended';

export default function NativeCallTestPanel() {
  const [reg, setReg] = useState<Reg>('checking');
  const [call, setCall] = useState<Call>('idle');
  const [number, setNumber] = useState('+30');
  const [note, setNote] = useState<string | null>(null);
  const callSidRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await isNativeVoiceAvailable())) {
        if (!cancelled) setReg('web');
        return;
      }
      if (!cancelled) setReg('registering');
      const ok = await initNativeVoice({
        // Android fires registrationSuccess; iOS NEVER does (the plugin has no
        // PushKit) yet login() still succeeds and OUTBOUND works — so we treat the
        // login() return value as readiness and don't gate on this event.
        onRegistered: () => !cancelled && setReg('registered'),
        onRegistrationFailed: (e) => { if (!cancelled) setNote(e); },
        onRinging: () => !cancelled && setCall('ringing'),
        onConnected: () => !cancelled && setCall('connected'),
        onDisconnected: (d) => { if (!cancelled) { setCall('ended'); if (d.error) setNote(d.error); } },
      });
      if (!cancelled) setReg(ok ? 'registered' : 'no_token');
    })();
    return () => { cancelled = true; };
  }, []);

  // Native-only: nothing on the web.
  if (reg === 'web' || reg === 'checking') return null;

  async function dial() {
    setNote(null);
    setCall('dialing');
    const r = await placeNativeCall(number.trim());
    callSidRef.current = r.callSid;
    if (!r.ok) { setCall('idle'); setNote('Δεν ξεκίνησε η κλήση.'); }
  }
  async function hang() {
    await endNativeCall(callSidRef.current);
    setCall('idle');
  }

  const inCall = call === 'dialing' || call === 'ringing' || call === 'connected';

  return (
    <div className="mt-4 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
      <p className="text-sm font-semibold text-zinc-900">Δοκιμή κλήσης (beta)</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Δοκιμαστική εξερχόμενη κλήση μέσα από την εφαρμογή, με τον αριθμό σου ως αναγνώριση.
      </p>

      <p className="mt-2 text-xs">
        Κατάσταση:{' '}
        {reg === 'registering' && <span className="text-zinc-500">σύνδεση…</span>}
        {reg === 'registered' && <span className="font-semibold text-green-700">Συνδεδεμένο ✓</span>}
        {reg === 'failed' && <span className="font-semibold text-red-600">Αποτυχία σύνδεσης</span>}
        {reg === 'no_token' && <span className="font-semibold text-amber-600">Το Twilio δεν είναι ρυθμισμένο ακόμα</span>}
      </p>

      {reg === 'registered' && (
        <div className="mt-3 space-y-2">
          <input
            type="tel"
            inputMode="tel"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+306900000000"
            disabled={inCall}
            className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-zinc-50"
          />
          {!inCall ? (
            <button
              type="button"
              onClick={dial}
              className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              📞 Κλήση
            </button>
          ) : (
            <button
              type="button"
              onClick={hang}
              className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              {call === 'connected' ? 'Τερματισμός' : call === 'ringing' ? 'Κουδουνίζει… (Τερματισμός)' : 'Κλήση… (Άκυρο)'}
            </button>
          )}
          {call === 'connected' && <p className="text-xs text-green-700">Σε κλήση ✓</p>}
          {call === 'ended' && <p className="text-xs text-zinc-500">Η κλήση τερματίστηκε.</p>}
        </div>
      )}

      {note && <p className="mt-2 text-xs text-amber-600">{note}</p>}
    </div>
  );
}
