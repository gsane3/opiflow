'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { loadState } from '@/lib/storage';
import BottomNav from './BottomNav';
import DesktopSidebar from './DesktopSidebar';
import GlobalGuideGuard from './GlobalGuideGuard';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const state = loadState();
    if (state.userProfile && !state.userProfile.onboardingCompleted) {
      router.replace('/onboarding');
    }
  }, [router, pathname]);

  return (
    <div className="flex min-h-full overflow-x-hidden">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* Guide guard: visible when guide is active and user is on wrong page */}
        <GlobalGuideGuard />
        {/* pb-24 ensures content clears bottom nav on mobile */}
        <main className="min-w-0 flex-1 overflow-x-hidden pb-24 md:pb-6 scroll-smooth bg-[#F5F5F7]">{children}</main>
        <BottomNav />
        {!pathname.startsWith('/calls') && (
          <Link
            href="/calls"
            className="fixed bottom-20 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white shadow-lg ring-1 ring-green-500/20 transition hover:bg-green-700 active:bg-green-800 md:hidden"
            aria-label="Άνοιγμα τηλεφώνου"
            title="Άνοιγμα τηλεφώνου"
          >
            <svg className="h-6 w-6" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
              />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}
