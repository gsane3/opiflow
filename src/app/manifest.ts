import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Opiflow — Επαγγελματικό τηλέφωνο & AI βοηθός',
    short_name: 'Opiflow',
    description: 'AI βοηθός για κλήσεις, πελάτες, follow-ups και προσφορές.',
    id: '/dashboard',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'el',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    background_color: '#f5f5f7',
    theme_color: '#00c499',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
