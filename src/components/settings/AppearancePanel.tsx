'use client';

import { useDarkMode } from '@/lib/useDarkMode';

// Ρυθμίσεις → Εμφάνιση → «Σκούρο θέμα» (mirrors the native toggle).
export default function AppearancePanel() {
  const { isDark, setDark } = useDarkMode();

  return (
    <div className="rounded-[22px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Σκούρο θέμα</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Ακολουθεί το σύστημα αν δεν το αλλάξεις χειροκίνητα.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isDark}
          aria-label="Σκούρο θέμα"
          onClick={() => setDark(!isDark)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition ${
            isDark ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
              isDark ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
