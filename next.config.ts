import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

// Supabase REST origin + its realtime websocket, derived from env so connect-src
// matches the configured project without hardcoding the ref. Wildcards cover the
// general case; the explicit origin is added when the env var is present.
function supabaseConnectSrc(): string[] {
  const out = ['https://*.supabase.co', 'wss://*.supabase.co'];
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (raw) {
      const origin = new URL(raw).origin; // https://<ref>.supabase.co
      const wss = origin.replace(/^https:/, 'wss:');
      if (!out.includes(origin)) out.push(origin);
      if (!out.includes(wss)) out.push(wss);
    }
  } catch {
    // ignore malformed env
  }
  return out;
}

// SIP-over-WebSocket gateway for the in-app phone (jsSIP). Derived from env so the
// browser's WebSocket to the SIP server is allowed by connect-src. Empty when unset.
function sipConnectSrc(): string[] {
  try {
    const raw = process.env.PHONE_SIP_WSS_URL;
    if (raw) {
      const origin = new URL(raw).origin; // wss://host:port
      if (origin) return [origin];
    }
  } catch {
    // ignore malformed env
  }
  return [];
}

// Content-Security-Policy. The app has no middleware (auth is client-side), so we
// cannot issue per-request nonces; Next's hydration bootstrap therefore relies on
// 'unsafe-inline' for scripts. 'unsafe-eval' is dev-only (React Refresh / HMR need
// it) and is dropped in production. Fonts are self-hosted (next/font), there are
// no third-party scripts/styles/images, and the only cross-origin connections are
// to Supabase (REST + realtime). A nonce-based policy is a future hardening step
// that requires middleware — see docs/PRODUCTION_ROADMAP.md.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  `connect-src 'self' ${[...supabaseConnectSrc(), ...sipConnectSrc()].join(' ')}`,
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// Security headers applied to every response. microphone=(self) is required for
// in-app calls and voice dictation.
const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=()' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
