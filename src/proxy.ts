import { NextResponse, type NextRequest } from 'next/server';

// CORS for /api/* so the native app (Expo/RN) — and its localhost web preview —
// can call the same backend cross-origin. The API is Bearer-JWT authenticated
// (no cookies), so allowing cross-origin reads/writes is safe: a browser never
// attaches the token automatically, and webhooks/server callers send no Origin
// header (so they're unaffected). Same-origin web requests ignore these headers.
// (Next 16 "proxy" convention — formerly "middleware".)

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '*';

  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders(origin))) res.headers.set(k, v);
  return res;
}

export const config = { matcher: '/api/:path*' };
