'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { registerNativePush } from '@/lib/native/push';
import BottomNav from './BottomNav';
import DesktopSidebar from './DesktopSidebar';
import PushToast from './PushToast';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const supabase = createBrowserSupabaseClient();
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        if (!data.session) {
          router.replace('/login');
          return;
        }

        // Onboarding + activation are gated on SERVER state (not localStorage),
        // so a fresh device or a new login is handled correctly.
        try {
          const meResp = await fetch('/api/businesses/me', {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          });
          if (cancelled) return;

          // No business yet → the user hasn't finished onboarding. Resume the
          // plan → onboarding flow instead of dropping them into an empty app.
          if (meResp.status === 404) {
            router.replace('/package');
            return;
          }

          if (meResp.ok) {
            const meData = (await meResp.json()) as {
              ok?: boolean;
              activationAllowed?: boolean;
            };
            if (meData.ok && meData.activationAllowed === false) {
              router.replace('/package?activation_required=1');
              return;
            }
          }
          // Other non-ok (transient 5xx) is non-fatal: let through.
        } catch {
          // Network error is non-fatal. Let through.
        }

        if (cancelled) return;
        setAuthChecked(true);

        // Native push: register this device once the session is confirmed.
        // No-op on web; failures are swallowed inside the helper.
        void registerNativePush((url) => router.push(url));
      } catch {
        // Auth client not configured or network error: redirect to login.
        if (!cancelled) {
          router.replace('/login');
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  // Do not render protected content until session check passes. Show a branded
  // splash (not a blank screen) so the launch feels app-like.
  if (!authChecked) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-[#F5F5F7]">
        <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-indigo-600 shadow-sm">
          <svg
            className="h-7 w-7 text-white"
            fill="none"
            strokeWidth={1.6}
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
            />
          </svg>
        </div>
        <div
          className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500 text-indigo-500"
          aria-label="Φόρτωση"
          role="status"
        />
      </div>
    );
  }

  // Full-screen chat manages its own height (header + scrolling messages +
  // pinned composer), so it must NOT get the normal bottom padding / page scroll.
  const isChatPage = /^\/customers\/[^/]+\/chat\/?$/.test(pathname);

  return (
    <div className="flex min-h-[100dvh] overflow-x-hidden">
      <PushToast />
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* Bottom padding clears the mobile nav + iOS home indicator (except the
            full-screen chat, which sizes itself above the nav). */}
        <main className={`min-w-0 flex-1 overflow-x-hidden scroll-smooth bg-[#F5F5F7] ${
          isChatPage ? 'overflow-y-hidden' : 'pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-6'
        }`}>{children}</main>

        {/* Global AI assistant: dictate or type any action from anywhere. */}
        {!pathname.startsWith('/cmd') && !pathname.startsWith('/customers/') && (
          <Link
            href="/cmd"
            aria-label="AI βοηθός"
            className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 transition hover:bg-indigo-700 active:scale-95 md:left-auto md:right-6 md:translate-x-0 md:bottom-6"
          >
            <svg className="h-6 w-6" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
            </svg>
          </Link>
        )}

        <BottomNav />
      </div>
    </div>
  );
}
