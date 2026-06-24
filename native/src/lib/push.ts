// Native push-notification registration for the Expo app.
//
// Registers this device's FCM token with the backend (POST /api/push/register)
// so missed-call / weekly-summary / customer-reply notifications reach the lock
// screen when the app is closed. The backend (src/lib/server/push.ts) sends via
// FCM HTTP v1, the device_push_tokens table stores one row per token, and the
// weekly-summary cron already targets it — only this device-side registration
// was missing.
//
// PLATFORM SCOPE:
//   • Android — fully wired today (google-services.json + Android FCM creds). The
//     Expo `getDevicePushTokenAsync()` returns the FCM token directly.
//   • iOS — SKIPPED for now. On iOS that call returns a RAW APNs token, which the
//     FCM-v1 backend cannot target; minting an FCM token on iOS needs Firebase-iOS
//     (GoogleService-Info.plist + an APNs key in Firebase), which isn't configured
//     for the Expo app yet (the config plugin is withFirebaseAndroidOnly). Until
//     that's set up, iOS in-app calls still ring via Twilio VoIP/CallKit; only the
//     non-call alerts are unavailable on iOS. See docs/NATIVE_PUSH_SETUP.md.
//
// Best-effort + lazy: expo-notifications is imported INSIDE the call (never at
// launch, mirroring the haptics/twilio modules), and every failure is swallowed,
// so push can never crash or block the app.

import { Platform } from 'react-native';
import { router } from 'expo-router';
import { apiPost } from '@/lib/api';

let registered = false;
let listenerAttached = false;

export async function registerPushToken(): Promise<void> {
  if (registered) return;
  // iOS needs Firebase-iOS to mint an FCM token; skip to avoid storing an
  // unusable APNs token (calls still ring via Twilio VoIP regardless).
  if (Platform.OS !== 'android') return;

  try {
    const Notifications = await import('expo-notifications');

    // Android 8+ requires a channel for notifications to be shown.
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Ειδοποιήσεις',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    } catch {
      /* channel best-effort */
    }

    // Navigate when the user taps a notification that carries a `url` (attach once).
    if (!listenerAttached) {
      listenerAttached = true;
      try {
        Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response?.notification?.request?.content?.data as
            | Record<string, unknown>
            | undefined;
          const url = typeof data?.url === 'string' ? data.url : undefined;
          if (url) {
            try {
              router.push(url as never);
            } catch {
              /* ignore bad url */
            }
          }
        });
      } catch {
        /* listener best-effort */
      }
    }

    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted && settings.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    const { data: token } = await Notifications.getDevicePushTokenAsync(); // FCM token on Android
    if (!token || typeof token !== 'string') return;

    await apiPost('/api/push/register', { token, platform: 'android' });
    registered = true;
  } catch {
    // ignore — retried on the next foreground / cold start
  }
}
