// POST /api/push/test
//
// Sends a test notification to the caller's OWN registered devices. Lets a user
// confirm push works end-to-end with one tap from Settings. Authed; inert-aware.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { isPushEnabled, sendPushToUser } from '@/lib/server/push';

export const runtime = 'nodejs';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function POST(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { userId } = auth.ctx;

  if (!isPushEnabled()) {
    return NextResponse.json(
      { ok: false, error: 'push_not_configured' },
      { status: 200, headers: NO_STORE }
    );
  }

  const result = await sendPushToUser(userId, {
    title: 'Opiflow',
    body: 'Οι ειδοποιήσεις δουλεύουν! 🎉',
    url: '/',
    data: { type: 'test' },
  });

  return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE });
}
