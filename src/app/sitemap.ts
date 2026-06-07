import type { MetadataRoute } from 'next';

const SITE = 'https://opiflow.vercel.app';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE}/login`, lastModified: now, changeFrequency: 'yearly', priority: 0.5 },
    { url: `${SITE}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
