import { NextResponse } from 'next/server';

// Apple Universal Links association, served at
// /.well-known/apple-app-site-association as application/json (no extension).
//
// Returns 404 until APPLE_APP_ID is set (format: <TeamID>.<bundleId>, e.g.
// "ABCDE12345.ai.opiflow.app"), so a misconfigured deploy never publishes a
// broken association that would silently disable Universal Links. Once set,
// taps on opiflow.vercel.app links open the installed app instead of the browser.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const appId = process.env.APPLE_APP_ID?.trim();
  if (!appId) {
    return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  }

  return NextResponse.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          // Open every opiflow.vercel.app path in-app; Apple always excludes /.well-known.
          paths: ['*'],
        },
      ],
    },
  });
}
