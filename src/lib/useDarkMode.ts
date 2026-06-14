'use client';

import { useEffect, useState } from 'react';

// Reads/sets the web dark theme. The `dark` class on <html> is applied before
// paint by the inline script in layout.tsx (anti-FOUC); this hook keeps a React
// state mirror and persists the user's choice. Mirrors the native «Σκούρο θέμα».
export function useDarkMode() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  function setDark(value: boolean) {
    setIsDark(value);
    document.documentElement.classList.toggle('dark', value);
    try {
      localStorage.setItem('opiflow-theme', value ? 'dark' : 'light');
    } catch {
      // private mode / storage disabled — toggle still applies for this session
    }
  }

  return { isDark, setDark };
}
