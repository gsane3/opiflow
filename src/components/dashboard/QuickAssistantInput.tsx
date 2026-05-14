'use client';

import { useState } from 'react';

export default function QuickAssistantInput() {
  const [text, setText] = useState('');

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
      <p className="text-sm font-medium text-zinc-700">Τι θέλεις να οργανώσω;</p>

      <div className="mt-3 flex gap-2">
        {/* Mic — stub */}
        <button
          disabled
          title="Φωνητική υπαγόρευση — Σύντομα"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 cursor-not-allowed"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            strokeWidth={1.5}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
            />
          </svg>
        </button>

        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='π.χ. "Φτιάξε προσφορά στον Καραγιάννη με 100€ εργασία"'
          className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />

        {/* Submit — stub */}
        <button
          disabled
          title="Σύντομα διαθέσιμο"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 cursor-not-allowed"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            strokeWidth={2}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
            />
          </svg>
        </button>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-400">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-300" />
        AI σύνδεση ενεργοποιείται σε επόμενο βήμα
      </p>
    </div>
  );
}
