'use client';

// Inline offer-accept for the public portal. POSTs to the folder-scoped endpoint
// (the folder token in the URL is the credential). On success the row flips to
// «Αποδεκτή ✓»; «Έχω απορία» is handled by the QuestionForm below the offers.

import { useState } from 'react';

export default function OfferAcceptButton({ token, offerId }: { token: string; offerId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  async function accept() {
    setState('busy');
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/offer/${offerId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: 'accepted' }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setState(res.ok && json?.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'done') {
    return (
      <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-green-700">
        <span aria-hidden>✓</span> Αποδεκτή
      </p>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={accept}
        disabled={state === 'busy'}
        className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
      >
        {state === 'busy' ? 'Γίνεται…' : 'Αποδοχή'}
      </button>
      {state === 'error' && (
        <p className="mt-1 text-xs text-red-600">Κάτι πήγε στραβά. Δοκιμάστε ξανά ή στείλτε μας μήνυμα πιο κάτω.</p>
      )}
    </div>
  );
}
