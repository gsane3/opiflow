'use client';

// Native entry gate.
//
// In the Capacitor native app the WebView loads the site root (the marketing
// landing). A real app should open straight into the product, not the marketing
// page — so on native this redirects `/` → `/login` (which itself forwards an
// already-authenticated user on to `/dashboard`). On the web it renders nothing
// and is a complete no-op, so the public landing page is unaffected.
//
// Detection runs in an effect (not during render) to stay hydration-safe; while
// the redirect happens a full-screen splash covers the marketing content so the
// homepage never visibly flashes inside the app.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OpiflowMark } from '@/components/brand/OpiflowLogo';

function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return cap?.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

export default function NativeGate() {
  const router = useRouter();
  const [native, setNative] = useState(false);

  useEffect(() => {
    if (isNativePlatform()) {
      setNative(true);
      router.replace('/login');
    }
  }, [router]);

  if (!native) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-white"
      aria-hidden
    >
      <OpiflowMark className="h-14 w-14 animate-pulse" />
    </div>
  );
}
