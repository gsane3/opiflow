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

## iOS — enablement runbook (currently skipped on purpose)
`registerPushToken()` **no-ops on iOS** because `getDevicePushTokenAsync()` returns a
raw **APNs** token there, which the FCM-v1 backend cannot target. iOS needs a real
**FCM** token, which means Firebase-iOS + `@react-native-firebase/messaging`. Follow
these in order — steps 1–2 + 6 are yours (credentials/build); 3–5 are code.

**1. Firebase console (owner)**
   - Add an **iOS app** to the existing Firebase project (bundle `ai.opiflow.app`).
   - Download **`GoogleService-Info.plist`** → place at `native/GoogleService-Info.plist`.

**2. APNs key (owner)**
   - Apple Developer → Keys → create an **APNs Auth Key (.p8)** (note the Key ID + Team ID).
   - Firebase → Project settings → **Cloud Messaging** → iOS app → upload the `.p8`.

**3. Add the messaging package (code)**
   ```bash
   cd native && npx expo install @react-native-firebase/messaging
   ```
   `@react-native-firebase/app` is already a dep; this adds the FCM token API.

**4. Config plugin — include iOS (code)**
   In `native/app.json`:
   - add `"ios": { ..., "googleServicesFile": "./GoogleService-Info.plist" }`,
   - switch the `"./plugins/withFirebaseAndroidOnly"` entry to the stock
     `"@react-native-firebase/app"` plugin (now safe — the iOS plist exists), or
     extend `withFirebaseAndroidOnly` with `withIosGoogleServicesFile`.
   Keep the existing `useFrameworks: "static"` iOS build property.

**5. Register the FCM token on iOS (code)** — in `native/src/lib/push.ts`:
   - remove the `if (Platform.OS !== 'android') return;` early return,
   - on iOS get the token via messaging instead of `getDevicePushTokenAsync()`:
     ```ts
     import messaging from '@react-native-firebase/messaging';
     // iOS: register the device with APNs, then mint an FCM token.
     await messaging().registerDeviceForRemoteMessages();
     const token = await messaging().getToken();
     await apiPost('/api/push/register', { token, platform: 'ios' });
     ```
   - Android path stays exactly as-is. (The backend `device_push_tokens` + FCM v1
     sender already accept any platform — no server change needed; FCM relays to
     APNs once the `.p8` is uploaded in step 2.)

**6. Build + verify (owner)**
   - `eas build -p ios` → install on a device → log in → grant the notification permission.
   - Confirm a `device_push_tokens` row with platform `ios` appears.
   - Trigger `/api/cron/weekly-summary` (or get a missed call) → a lock-screen push.

Until this is done, iOS users still get **incoming-call rings** (Twilio VoIP/CallKit) —
only the missed-call/weekly-summary/reply *alerts* are Android-only.

## Note
This is the **Expo** app's push. The parallel Capacitor app already has full
iOS+Android push via `@capacitor-firebase/messaging` (`src/lib/native/push.ts`) —
if the project consolidates onto Capacitor, push is already solved there.
