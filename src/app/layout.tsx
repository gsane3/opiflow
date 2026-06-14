import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Opiflow',
    template: '%s · Opiflow',
  },
  description: 'Ο AI βοηθός σου για πελάτες, follow-ups και προσφορές.',
  applicationName: 'Opiflow',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Opiflow',
    statusBarStyle: 'default',
  },
  // Phone numbers are surfaced through explicit call actions, not auto-detected
  // links, so we keep rendering predictable across iOS/Android.
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

// Mobile-first viewport: device width, no forced zoom lock (a11y), and
// viewport-fit=cover so we can pad around the iOS notch / home indicator.
export const viewport: Viewport = {
  themeColor: '#2a86c5',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

// Runs before paint: apply the saved theme (or the system preference) so there's
// no light flash before React hydrates. Mirrors the native «Σκούρο θέμα» toggle.
const themeScript = `(function(){try{var t=localStorage.getItem('opiflow-theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="el" className={`${geist.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full bg-zinc-50 text-zinc-900 antialiased font-sans dark:bg-[#0e1722] dark:text-[#eaf0f6]">
        {children}
      </body>
    </html>
  );
}
