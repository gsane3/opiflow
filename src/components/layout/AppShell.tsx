'use client';

import { useEffect } from 'react';
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
        {/* Guide guard — visible when guide is active and user is on wrong page */}
        <GlobalGuideGuard />
        {/* pb-24 ensures content clears bottom nav on mobile */}
        <main className="min-w-0 flex-1 overflow-x-hidden pb-24 md:pb-6">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}
