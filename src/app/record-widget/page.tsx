'use client';

// Auth-less voice-recorder widget loaded inside the native app's WebView. It records
// the call-recording disclosure clip and posts it back to the native layer, which
// uploads it with the user's session (so the page needs no auth). Served over HTTPS
// so getUserMedia works — a WebView fed inline HTML is NOT a secure context and the
// mic would be blocked, which is why this is a real page on opiflow.ai.

import { useState } from 'react';
import DisclosureRecorder from '@/components/onboarding/DisclosureRecorder';

export default function RecordWidgetPage() {
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);

  function useIt() {
    if (!value) return;
    const w = window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } };
    if (w.ReactNativeWebView) {
      try {
        w.ReactNativeWebView.postMessage(JSON.stringify({ type: 'disclosure', audio: value }));
        setSent(true);
      } catch { /* ignore */ }
    }
  }

  return (
    <main className="min-h-[100dvh] bg-white px-5 py-8 dark:bg-[#0e1722]">
      <div className="mx-auto max-w-md">
        <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
          Μήνυμα ηχογράφησης κλήσεων
        </h1>
        {sent ? (
          <div className="mt-6 rounded-2xl bg-emerald-50 px-4 py-5 text-[15px] leading-relaxed text-emerald-800 ring-1 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-200">
            ✓ Στάλθηκε! Κλείσε αυτό το παράθυρο και επέστρεψε στην εφαρμογή.
            <button
              type="button"
              onClick={() => { setSent(false); setValue(''); }}
              className="mt-3 block text-sm font-medium text-emerald-700 underline dark:text-emerald-300"
            >
              Ηχογράφησε ξανά
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <DisclosureRecorder value={value} onChange={setValue} />
            {value && (
              <button
                type="button"
                onClick={useIt}
                className="rounded-2xl bg-indigo-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
              >
                Χρησιμοποίησέ το
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
