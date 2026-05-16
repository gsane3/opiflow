'use client';

import { useEffect } from 'react';

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function ActionSheet({ open, title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet panel */}
      <div className="fixed bottom-0 inset-x-0 z-[60] flex max-h-[82vh] flex-col rounded-t-2xl bg-white shadow-2xl">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-zinc-200" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-1 shrink-0 border-b border-zinc-100">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-zinc-900 leading-snug">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 transition"
          >
            <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-5 py-4 pb-8 space-y-3">
          {children}
        </div>
      </div>
    </>
  );
}
