# Native push notifications (Expo app) — state & setup

The Expo app now registers for non-call push (missed-call / weekly-summary /
customer-reply alerts that arrive while the app is closed). Incoming **calls**
always rang via Twilio VoIP/CallKit — this is the *other* notifications.

## What's wired (this PR)
- `native/src/lib/push.ts` → `registerPushToken()`: requests notification
  permission, gets the device's **FCM token** (`expo-notifications`
  `getDevicePushTokenAsync()`), and POSTs it to `/api/push/register`.
- Called after login in `native/src/app/_layout.tsx` (best-effort, guarded — can
  never crash the app). Taps with a `data.url` deep-link via `expo-router`.
- Backend was already complete: `device_push_tokens` (migration 032),
  `/api/push/register`, the FCM HTTP v1 sender (`src/lib/server/push.ts`), and the
  weekly-summary cron.

## Android — works end-to-end today
`google-services.json` + the Android FCM credential are configured, so
`getDevicePushTokenAsync()` returns a real FCM token. After a **new EAS build**:
1. Log in → grant the notification permission.
2. Confirm a row appears in `device_push_tokens` (platform `android`).
3. Trigger `/api/cron/weekly-summary` (or get a missed call) → a lock-screen push.

## iOS — needs Firebase-iOS first (currently skipped on purpose)
`registerPushToken()` **no-ops on iOS** because `getDevicePushTokenAsync()` returns
a raw **APNs** token there, which the FCM-v1 backend cannot target. To enable iOS:
1. In Firebase console add an **iOS app**; download `GoogleService-Info.plist`.
2. Upload your **APNs Auth Key (.p8)** to Firebase → Cloud Messaging.
3. Wire Firebase-iOS into the Expo build — either extend the custom
   `native/plugins/withFirebaseAndroidOnly` to include iOS, or add
   `@react-native-firebase/messaging` and call `messaging().getToken()` (which
   mints an FCM token on iOS) instead of `getDevicePushTokenAsync()`.
4. Remove the `Platform.OS !== 'android'` early-return in `push.ts`.

Until then, iOS users still get **incoming-call rings** (Twilio VoIP) — only the
missed-call/weekly-summary/reply *alerts* are Android-only.

## Note
This is the **Expo** app's push. The parallel Capacitor app already has full
iOS+Android push via `@capacitor-firebase/messaging` (`src/lib/native/push.ts`) —
if the project consolidates onto Capacitor, push is already solved there.
