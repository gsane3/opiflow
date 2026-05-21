'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-zinc-400">Φόρτωση...</p>
    </div>
  );
}
