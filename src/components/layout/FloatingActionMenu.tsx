'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isDemoGuideActive } from '@/lib/demo-guide-session';

const ACTIONS = [
  { label: 'AI review', href: '/ai-review' },
  { label: 'Demo κλήση', href: '/call/mock' },
];

export default function FloatingActionMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [guideActive, setGuideActive] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setGuideActive(isDemoGuideActive());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function handleAction(href: string) {
    setOpen(false);
    router.push(href);
  }

  if (guideActive) return null;

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
          {[...ACTIONS].reverse().map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => handleAction(action.href)}
              className="flex items-center rounded-full bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-md ring-1 ring-zinc-200 transition hover:bg-zinc-50 active:bg-zinc-100"
            >
              {action.label}
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
    </>
  );
}
