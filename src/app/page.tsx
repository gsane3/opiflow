'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadState } from '@/lib/storage';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    const state = loadState();
    if (!state.userProfile) {
      router.replace('/demo');
    } else if (!state.userProfile.onboardingCompleted) {
      router.replace('/onboarding');
    } else {
      router.replace('/dashboard');
    }
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-zinc-400">Φόρτωση...</p>
    </div>
  );
}
