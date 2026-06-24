import type { MetadataRoute } from 'next';

const SITE = 'https://opiflow.vercel.app';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/login', '/register', '/terms', '/privacy'],
        // Keep the app, the API, and all private token pages out of search.
        disallow: [
          '/dashboard', '/customers', '/offers', '/tasks', '/appointments',
          '/settings', '/cmd', '/ai-review', '/number', '/package', '/onboarding',
          '/stats', '/search',
          '/api/', '/auth/', '/f/', '/intake/', '/offer-response/', '/appointment-response/',
          '/upload/', '/backend', '/login/backend', '/onboarding/backend',
          '/business/backend', '/communications/backend', '/customers/backend',
          '/phone-pool/backend',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
