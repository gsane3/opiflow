'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { loadState } from '@/lib/storage';
import BottomNav from './BottomNav';
import DesktopSidebar from './DesktopSidebar';
import FloatingActionMenu from './FloatingActionMenu';
import GlobalGuideGuard from './GlobalGuideGuard';

// FAB only on top-level list pages (not dashboard - it has 6 smart cards already)
const FAB_PATHS = new Set(['/customers', '/tasks', '/offers']);

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const state = loadState();
    if (!state.userProfile) {
      router.replace('/login');
    } else if (!state.userProfile.onboardingCompleted) {
      router.replace('/onboarding');
    }
  }, [router]);

  return (
    <div className="flex min-h-full overflow-x-hidden">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* Guide guard — visible when guide is active and user is on wrong page */}
        <GlobalGuideGuard />
        {/* pb-24 ensures content clears bottom nav + FAB on mobile */}
        <main className="min-w-0 flex-1 overflow-x-hidden pb-24 md:pb-6">{children}</main>
        <BottomNav />
      </div>
      {FAB_PATHS.has(pathname) && <FloatingActionMenu />}
    </div>
  );
}
