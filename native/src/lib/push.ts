// Native push-notification registration for the Expo app.
//
// Registers this device's **FCM token** with the backend (POST /api/push/register)
// so missed-call / weekly-summary / customer-reply notifications reach the lock
// screen when the app is closed. The backend (src/lib/server/push.ts) sends via FCM
// HTTP v1 — which delivers to BOTH Android and iOS (FCM relays to APNs once the APNs
// key is in the Firebase project). The device_push_tokens table stores one row per token.
//
// PLATFORM SCOPE:
//   • Android — `expo-notifications` getDevicePushTokenAsync() returns the FCM token.
//   • iOS — getDevicePushTokenAsync() returns a raw APNs token the FCM-v1 backend
//     can't target, so we mint an **FCM** token via @react-native-firebase/messaging
//     (messaging().getToken()). Requires Firebase-iOS (GoogleService-Info.plist + APNs
//     key in Firebase) — both configured. Incoming CALLS still ring via Twilio
//     VoIP/CallKit independently of this. See docs/NATIVE_PUSH_SETUP.md.
//
// Best-effort + lazy: the notification/messaging modules are imported INSIDE the call
// (never at launch, mirroring the haptics/twilio modules), and every failure is
// swallowed, so push can never crash or block the app. If Firebase-iOS isn't ready on
// a given build the iOS branch throws and is caught → no token stored (calls unaffected).

import { Platform } from 'react-native';
import { router } from 'expo-router';
import { apiPost } from '@/lib/api';

let registered = false;
let listenerAttached = false;

export async function registerPushToken(): Promise<void> {
  if (registered) return;

  try {
    const Notifications = await import('expo-notifications');

    // Android 8+ requires a channel for notifications to be shown.
    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Ειδοποιήσεις',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      } catch {
        /* channel best-effort */
      }
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

    // Mint the FCM token. Android: directly via expo-notifications. iOS: via Firebase
    // messaging (getDevicePushTokenAsync would hand back an unusable APNs token there).
    let token: string | null = null;
    let platform: 'android' | 'ios';
    if (Platform.OS === 'android') {
      const { data } = await Notifications.getDevicePushTokenAsync();
      token = typeof data === 'string' ? data : null;
      platform = 'android';
    } else if (Platform.OS === 'ios') {
      const messaging = (await import('@react-native-firebase/messaging')).default;
      await messaging().registerDeviceForRemoteMessages();
      token = await messaging().getToken();
      platform = 'ios';
    } else {
      return;
    }

    if (!token || typeof token !== 'string') return;

    await apiPost('/api/push/register', { token, platform });
    registered = true;
  } catch {
    // ignore — retried on the next foreground / cold start
  }
}
