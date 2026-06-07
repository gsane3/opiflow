'use client';

// Settings → notifications: a one-tap "send me a test push" so the user can
// confirm notifications work on their phone. The button talks to /api/push/test,
// which sends to the caller's own registered devices.

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type State = 'idle' | 'sending' | 'sent' | 'none' | 'off' | 'error';

const MESSAGES: Record<Exclude<State, 'idle' | 'sending'>, { text: string; cls: string }> = {
  sent: { text: 'Στάλθηκε! Έλεγξε το κινητό σου 📱', cls: 'text-emerald-700' },
  none: {
    text: 'Καμία συσκευή δεν είναι καταχωρημένη ακόμα. Άνοιξε την εφαρμογή στο κινητό, κάνε σύνδεση και επίτρεψε τις ειδοποιήσεις — μετά ξαναδοκίμασε.',
    cls: 'text-amber-600',
  },
  off: { text: 'Οι ειδοποιήσεις δεν είναι ρυθμισμένες ακόμα στον server.', cls: 'text-amber-600' },
  error: { text: 'Κάτι πήγε στραβά. Δοκίμασε ξανά.', cls: 'text-red-600' },
};

export default function NotificationsPanel() {
  const [state, setState] = useState<State>('idle');

  async function sendTest() {
    setState('sending');
    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setState('error');
        return;
      }
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        sent?: number;
      };
      if (json?.error === 'push_not_configured') {
        setState('off');
        return;
      }
      if (!json?.ok) {
        setState('error');
        return;
      }
      setState((json.sent ?? 0) > 0 ? 'sent' : 'none');
    } catch {
      setState('error');
    }
  }

  const msg = state !== 'idle' && state !== 'sending' ? MESSAGES[state] : null;

  return (
    <div className="mt-4 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
      <p className="text-sm font-semibold text-zinc-900">Ειδοποιήσεις</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Λάβε ειδοποίηση στο κινητό όταν ένας πελάτης απαντά σε προσφορά ή ραντεβού. Πάτα για δοκιμή.
      </p>
      <button
        type="button"
        onClick={sendTest}
        disabled={state === 'sending'}
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        <span aria-hidden>🔔</span>
        {state === 'sending' ? 'Αποστολή…' : 'Δοκιμή ειδοποίησης'}
      </button>
      {msg && <p className={`mt-2 text-xs ${msg.cls}`}>{msg.text}</p>}
    </div>
  );
}
