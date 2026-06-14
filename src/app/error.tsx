'use client';

import { useEffect } from 'react';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log for monitoring; never surface internal details to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-[#F5F5F7] px-6 text-center dark:bg-[#0e1722]">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
        <svg
          className="h-7 w-7 text-amber-600"
          fill="none"
          strokeWidth={1.6}
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Κάτι πήγε στραβά</h1>
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
          Παρουσιάστηκε ένα πρόβλημα. Δοκίμασε ξανά σε λίγο.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
      >
        Δοκίμασε ξανά
      </button>
    </div>
  );
}
