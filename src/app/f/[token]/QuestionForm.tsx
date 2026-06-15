'use client';

// Public folder question form (WF-3). The customer types one short question
// about their job and we POST it to /api/f/[token]/message. Extremely simple,
// mobile-first; no IDs, notes, or internal data — the only input is free text.

import { useState } from 'react';

type Status = 'idle' | 'sending' | 'sent' | 'error' | 'rate';

const MAX_LENGTH = 1000;

export default function QuestionForm({ token }: { token: string }) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const trimmed = message.trim();
  const canSend = trimmed.length > 0 && status !== 'sending';

  async function submit() {
    if (!canSend) return;
    setStatus('sending');
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (res.ok) {
        setStatus('sent');
        setMessage('');
        return;
      }
      if (res.status === 429) {
        setStatus('rate');
        return;
      }
      setStatus('error');
    } catch {
      setStatus('error');
    }
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-200/60">
      <p className="text-base font-semibold text-zinc-900">Έχετε κάποια απορία;</p>
      <p className="mt-1 text-sm text-zinc-500">Γράψτε μας κάτι για αυτή την εργασία.</p>

      <textarea
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
          // Clear a previous result the moment the customer edits again.
          if (status === 'sent' || status === 'error' || status === 'rate') setStatus('idle');
        }}
        maxLength={MAX_LENGTH}
        rows={4}
        placeholder="π.χ. Θέλω να ρωτήσω κάτι για το ραντεβού."
        className="mt-3 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-indigo-300 focus:bg-white"
      />

      <button
        type="button"
        onClick={submit}
        disabled={!canSend}
        className="mt-3 w-full rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-40"
      >
        {status === 'sending' ? 'Αποστολή…' : 'Αποστολή'}
      </button>

      {status === 'sent' && (
        <p className="mt-3 text-sm font-medium text-green-700">Το μήνυμά σας στάλθηκε.</p>
      )}
      {status === 'error' && (
        <p className="mt-3 text-sm text-red-600">Δεν στάλθηκε το μήνυμα. Δοκιμάστε ξανά.</p>
      )}
      {status === 'rate' && (
        <p className="mt-3 text-sm text-red-600">Πολλά αιτήματα. Δοκιμάστε ξανά σε λίγο.</p>
      )}
    </section>
  );
}
