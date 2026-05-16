'use client';

import { useState } from 'react';
import Link from 'next/link';

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

export default function DemoVoipKeypad() {
  const [number, setNumber] = useState('');
  const [showNotice, setShowNotice] = useState(false);

  function handleKey(k: string) {
    if (number.length >= 15) return;
    setNumber((n) => n + k);
    setShowNotice(false);
  }

  function handleBackspace() {
    setNumber((n) => n.slice(0, -1));
    setShowNotice(false);
  }

  function handleClear() {
    setNumber('');
    setShowNotice(false);
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 space-y-4 max-w-xs mx-auto w-full">
      {/* Header disclaimer */}
      <div className="text-center space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">
          Demo VoIP keypad
        </p>
        <p className="text-[11px] text-zinc-400 leading-snug">
          Στο MVP δεν γίνεται πραγματική κλήση.
        </p>
        <p className="text-[11px] text-zinc-400 leading-snug">
          Στο τελικό προϊόν θα συνδεθεί VoIP provider.
        </p>
      </div>

      {/* Number display */}
      <div className="flex items-center gap-2 rounded-xl bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200 min-h-[52px]">
        <span className="flex-1 text-center font-mono text-lg font-medium tracking-widest text-zinc-900">
          {number ? (
            number
          ) : (
            <span className="text-zinc-300 text-base font-normal">+30 ...</span>
          )}
        </span>
        {number && (
          <button
            type="button"
            onClick={handleBackspace}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-200 active:bg-zinc-300 transition"
            aria-label="Διαγραφή τελευταίου ψηφίου"
          >
            ⌫
          </button>
        )}
      </div>

      {/* Keypad grid */}
      <div className="grid grid-cols-3 gap-2.5">
        {KEYS.flat().map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => handleKey(k)}
            className="flex h-14 items-center justify-center rounded-xl bg-zinc-100 text-lg font-medium text-zinc-800 transition hover:bg-zinc-200 active:bg-zinc-300 select-none"
          >
            {k}
          </button>
        ))}
      </div>

      {/* Clear */}
      {number && (
        <button
          type="button"
          onClick={handleClear}
          className="w-full rounded-xl border border-zinc-200 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-50"
        >
          Καθαρισμός
        </button>
      )}

      {/* Demo call notice — shown after pressing "Demo κλήση" */}
      {showNotice && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200 space-y-1.5">
          <p className="text-sm font-semibold text-amber-800">
            Δεν έγινε πραγματική κλήση.
          </p>
          <p className="text-xs text-amber-700">
            Στο τελικό προϊόν εδώ θα συνδέεται VoIP provider. Στο MVP δεν υπάρχει
            in-app κλήση ή ηχογράφηση.
          </p>
          <Link
            href="/call/mock"
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            Δοκίμασε πλήρη demo κλήση →
          </Link>
        </div>
      )}

      {/* Action buttons */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowNotice(true)}
          className="w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
        >
          Demo κλήση
        </button>

        {/* Native tel: link — clearly labelled as device call, not in-app VoIP */}
        {number && (
          <a
            href={`tel:${number}`}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
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
                d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6.75Z"
              />
            </svg>
            Άνοιγμα native κλήσης (συσκευή)
          </a>
        )}
      </div>

      {/* Footer disclaimer */}
      <p className="text-center text-[10px] text-zinc-300 leading-snug">
        Χωρίς VoIP provider · Χωρίς ηχογράφηση · Χωρίς in-app κλήση
      </p>
    </div>
  );
}
