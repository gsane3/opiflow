import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'yorgos.ai',
    short_name: 'yorgos.ai',
    description: 'AI βοηθός για πελάτες, follow-ups και προσφορές.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#4f46e5',
    icons: [],
  };
}
