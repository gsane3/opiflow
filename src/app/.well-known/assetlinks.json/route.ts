import { NextResponse } from 'next/server';

// Android App Links association, served at /.well-known/assetlinks.json.
//
// Returns 404 until ANDROID_SHA256_CERT_FINGERPRINTS is set (comma-separated
// upper-case SHA-256 signing-certificate fingerprints from `keytool -list` or
// the Play Console "App signing" page). The package name defaults to the
// Capacitor appId. Once set, verified App Links open opiflow.vercel.app URLs in-app.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (fingerprints.length === 0) {
    return NextResponse.json({ error: 'not_configured' }, { status: 404 });
  }

  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim() || 'ai.opiflow.app';

  return NextResponse.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}
