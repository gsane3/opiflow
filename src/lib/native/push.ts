'use client';

// Native push registration (Capacitor + Firebase Cloud Messaging).
//
// Uses @capacitor-firebase/messaging so BOTH iOS and Android emit a unified FCM
// registration token — which is exactly what our server (src/lib/server/push.ts,
// FCM HTTP v1) targets. On iOS the Firebase SDK turns the APNs token into an FCM
// token and FCM relays back to APNs; on Android it returns the same FCM token it
// always did. (The older @capacitor/push-notifications returned a RAW APNs token
// on iOS, which FCM v1 rejects — that was the bug this replaces.)
//
// On the web this is a NO-OP — every path is guarded by isNativePlatform(), and
// the plugin is dynamically imported so it never enters the web bundle. Push is a
// non-critical enhancement: any failure is swallowed.

import { createBrowserSupabaseClient } from '@/lib/supabase/client';

let initialized = false;

async function sendToken(token: string, platform: 'android' | 'ios'): Promise<void> {
  try {
    const supabase = createBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) return;
    await fetch('/api/push/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token, platform }),
    });
  } catch {
    // ignore — registration will be retried on the next cold start / token refresh
  }
}

/**
 * Registers the current device for push notifications via Firebase Messaging.
 * Safe to call on web (returns immediately) and idempotent within a JS context.
 * @param navigate optional SPA navigation used when a notification is tapped.
 */
export async function registerNativePush(navigate?: (url: string) => void): Promise<void> {
  if (initialized) return;

  let Capacitor: (typeof import('@capacitor/core'))['Capacitor'];
  try {
    ({ Capacitor } = await import('@capacitor/core'));
  } catch {
    return;
  }
  if (!Capacitor?.isNativePlatform?.()) return; // web / PWA → skip
  initialized = true;

  const platform: 'android' | 'ios' = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';

  let FirebaseMessaging: (typeof import('@capacitor-firebase/messaging'))['FirebaseMessaging'];
  try {
    ({ FirebaseMessaging } = await import('@capacitor-firebase/messaging'));
  } catch {
    return;
  }

  try {
    // Token can arrive via the listener (refresh, or after async APNs→FCM on iOS)
    // as well as the direct getToken() call below — both feed the same register.
    await FirebaseMessaging.addListener('tokenReceived', (event) => {
      if (event?.token) void sendToken(event.token, platform);
    });
    await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      const data = event?.notification?.data as Record<string, unknown> | undefined;
      const url = typeof data?.url === 'string' ? data.url : undefined;
      if (!url) return;
      if (navigate) navigate(url);
      else window.location.assign(url);
    });
    // Foreground messages are NOT auto-shown in the system tray — surface them as
    // an in-app banner (see PushToast). Fires only on a real device that receives
    // FCM while the app is open.
    await FirebaseMessaging.addListener('notificationReceived', (event) => {
      const n = event?.notification;
      if (!n) return;
      const data = n.data as Record<string, unknown> | undefined;
      const url = typeof data?.url === 'string' ? data.url : undefined;
      try {
        window.dispatchEvent(
          new CustomEvent('opiflow:push', {
            detail: { title: n.title ?? 'Opiflow', body: n.body ?? '', url },
          })
        );
      } catch {
        // ignore
      }
    });

    let perm = await FirebaseMessaging.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await FirebaseMessaging.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    // Direct fetch. On iOS this needs the APNs token to be set first; if it races
    // ahead the call throws and we rely on the tokenReceived listener instead.
    try {
      const { token } = await FirebaseMessaging.getToken();
      if (token) void sendToken(token, platform);
    } catch {
      // tokenReceived listener will deliver it shortly
    }
  } catch {
    // ignore — push is an enhancement, never block the app
  }
}
