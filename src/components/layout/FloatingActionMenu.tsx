'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const actions = [
  { label: 'Νέα κλήση' },
  { label: 'Υπαγόρευση' },
  { label: 'Νέος πελάτης' },
  { label: 'Νέα προσφορά' },
];

export default function FloatingActionMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function handleAction(label: string) {
    setOpen(false);
    if (label === 'Υπαγόρευση') {
      router.push('/ai-review');
      return;
    }
    setToast(`${label} — Σύντομα`);
    setTimeout(() => setToast(null), 2200);
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {open && (
        <div className="fixed bottom-40 right-4 z-50 flex flex-col items-end gap-2 md:bottom-24">
          {[...actions].reverse().map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => handleAction(action.label)}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-md ring-1 ring-zinc-200 transition hover:bg-zinc-50 active:bg-zinc-100"
            >
              <span>{action.label}</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-400">
                Σύντομα
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition hover:bg-indigo-700 active:bg-indigo-800 md:bottom-6"
        aria-label={open ? 'Κλείσιμο μενού' : 'Νέα ενέργεια'}
      >
        <svg
          className={`h-6 w-6 transition-transform duration-200 ${open ? 'rotate-45' : ''}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4.5v15m7.5-7.5h-15"
          />
        </svg>
      </button>

      {toast && (
        <div className="fixed bottom-40 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-800 px-4 py-2 text-sm text-white shadow-lg md:bottom-24">
          {toast}
        </div>
      )}
    </>
  );
}
