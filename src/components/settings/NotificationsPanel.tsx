'use client';

// Settings → notifications: a one-tap "send me a test push" so the user can
// confirm notifications work on their phone. Talks to /api/push/test, which
// sends to the caller's own registered devices and reports a per-device result
// (so we can tell apart "no device registered", "delivered", and "stale token").

import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface SendDetail {
  platform: string;
  ok: boolean;
  error?: string;
}
interface Result {
  sent: number;
  failed: number;
  tokenCount: number;
  details: SendDetail[];
}

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'ok'; result: Result }
  | { kind: 'none' }
  | { kind: 'off' }
  | { kind: 'error' };

export default function NotificationsPanel() {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function sendTest() {
    setState({ kind: 'sending' });
    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setState({ kind: 'error' });
        return;
      }
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Result> & {
        ok?: boolean;
        error?: string;
      };
      if (json?.error === 'push_not_configured') {
        setState({ kind: 'off' });
        return;
      }
      if (!json?.ok) {
        setState({ kind: 'error' });
        return;
      }
      const result: Result = {
        sent: json.sent ?? 0,
        failed: json.failed ?? 0,
        tokenCount: json.tokenCount ?? 0,
        details: json.details ?? [],
      };
      if (result.tokenCount === 0) {
        setState({ kind: 'none' });
        return;
      }
      setState({ kind: 'ok', result });
    } catch {
      setState({ kind: 'error' });
    }
  }

  return (
    <div className="mt-4 rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
      <p className="text-sm font-semibold text-zinc-900">Ειδοποιήσεις</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        Λάβε ειδοποίηση στο κινητό όταν ένας πελάτης απαντά σε προσφορά ή ραντεβού. Πάτα για δοκιμή.
      </p>
      <button
        type="button"
        onClick={sendTest}
        disabled={state.kind === 'sending'}
        className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        <span aria-hidden>🔔</span>
        {state.kind === 'sending' ? 'Αποστολή…' : 'Δοκιμή ειδοποίησης'}
      </button>

      {state.kind === 'ok' && (
        <div className="mt-2 text-xs">
          {state.result.sent > 0 ? (
            <p className="text-emerald-700">
              Στάλθηκε σε {state.result.sent} από {state.result.tokenCount}{' '}
              {state.result.tokenCount === 1 ? 'συσκευή' : 'συσκευές'} 📱 — βγες από την εφαρμογή (κουμπί Home) για να δεις την ειδοποίηση.
            </p>
          ) : (
            <p className="text-amber-600">
              Βρέθηκαν {state.result.tokenCount}{' '}
              {state.result.tokenCount === 1 ? 'συσκευή' : 'συσκευές'} αλλά καμία δεν δέχτηκε την αποστολή.
            </p>
          )}
          {state.result.failed > 0 && (
            <p className="mt-1 text-zinc-400">
              Αποτυχίες: {state.result.details.filter((d) => !d.ok).map((d) => `${d.platform}:${d.error ?? '?'}`).join(', ')}
            </p>
          )}
        </div>
      )}
      {state.kind === 'none' && (
        <p className="mt-2 text-xs text-amber-600">
          Καμία συσκευή δεν είναι καταχωρημένη ακόμα. Άνοιξε την εφαρμογή στο κινητό, κάνε σύνδεση και επίτρεψε τις ειδοποιήσεις — μετά ξαναδοκίμασε.
        </p>
      )}
      {state.kind === 'off' && (
        <p className="mt-2 text-xs text-amber-600">Οι ειδοποιήσεις δεν είναι ρυθμισμένες ακόμα στον server.</p>
      )}
      {state.kind === 'error' && (
        <p className="mt-2 text-xs text-red-600">Κάτι πήγε στραβά. Δοκίμασε ξανά.</p>
      )}
    </div>
  );
}
