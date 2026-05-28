'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { loadState } from '@/lib/storage';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import BottomNav from './BottomNav';
import DesktopSidebar from './DesktopSidebar';
import GlobalGuideGuard from './GlobalGuideGuard';

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

        // Session confirmed. Now apply the onboarding redirect if needed.
        const state = loadState();
        if (state.userProfile && !state.userProfile.onboardingCompleted) {
          router.replace('/onboarding');
          return;
        }

        // Activation guard: check subscription status via /api/businesses/me.
        // Non-ok responses (no business yet, network error) are let through;
        // the inner app handles a missing business gracefully.
        try {
          const meResp = await fetch('/api/businesses/me', {
            headers: { Authorization: `Bearer ${data.session.access_token}` },
          });
          if (!cancelled && meResp.ok) {
            const meData = (await meResp.json()) as {
              ok?: boolean;
              activationAllowed?: boolean;
            };
            if (meData.ok && meData.activationAllowed === false) {
              router.replace('/package?activation_required=1');
              return;
            }
          }
        } catch {
          // Activation check network error is non-fatal. Let through.
        }

        if (cancelled) return;
        setAuthChecked(true);
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

  // Do not render protected content until session check passes.
  if (!authChecked) {
    return null;
  }

  return (
    <div className="flex min-h-full overflow-x-hidden">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* Guide guard: visible when guide is active and user is on wrong page */}
        <GlobalGuideGuard />
        {/* pb-24 ensures content clears bottom nav on mobile */}
        <main className="min-w-0 flex-1 overflow-x-hidden pb-24 md:pb-6 scroll-smooth bg-[#F5F5F7]">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
