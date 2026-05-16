'use client';

import { useState } from 'react';

interface Props {
  title?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export default function PageHelp({ title = 'Τι βλέπω εδώ;', children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl bg-zinc-50 ring-1 ring-zinc-100">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
          <svg className="h-3.5 w-3.5 shrink-0 text-zinc-400" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
          </svg>
          {title}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-1.5 border-t border-zinc-100 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}
