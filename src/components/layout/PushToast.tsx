'use client';

// In-app notification banner. When a push arrives while the app is in the
// FOREGROUND, Android/iOS do NOT auto-display it in the system tray — they hand
// it to the app. src/lib/native/push.ts forwards such messages as a window
// 'opiflow:push' CustomEvent; this component shows a tappable banner for them.
//
// Pure client UI — no native plugin. Harmless on web (the event simply never
// fires there).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Toast {
  title: string;
  body: string;
  url?: string;
}

export default function PushToast() {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    function onPush(e: Event) {
      const detail = (e as CustomEvent).detail as Toast | undefined;
      if (!detail) return;
      setToast(detail);
    }
    window.addEventListener('opiflow:push', onPush as EventListener);
    return () => window.removeEventListener('opiflow:push', onPush as EventListener);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  const url = toast.url;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl bg-white/95 dark:bg-[#17232f]/95 p-3 shadow-lg ring-1 ring-zinc-200/70 dark:ring-white/10 backdrop-blur animate-[slideDown_0.25s_ease-out]"
      >
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-base">
          🔔
        </div>
        <button
          type="button"
          onClick={() => {
            setToast(null);
            if (url) router.push(url);
          }}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{toast.title}</p>
          {toast.body && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{toast.body}</p>}
        </button>
        <button
          type="button"
          aria-label="Κλείσιμο"
          onClick={() => setToast(null)}
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-100 dark:hover:bg-white/5 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
