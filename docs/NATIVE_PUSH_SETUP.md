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

## iOS — wired (2026-06-26); only an EAS build remains
The code + Firebase are done; iOS now mints a real **FCM** token via
`@react-native-firebase/messaging` (`messaging().getToken()`). Status of each step:

- ✅ **1. Firebase iOS app** «Opiflow iOS» (`ai.opiflow.app`) + `GoogleService-Info.plist`
  committed at `native/GoogleService-Info.plist`.
- ✅ **2. APNs Auth Key** (`2Q2FHTPV4U` / Team `7Q7A3NFK8T`) uploaded to Firebase →
  Cloud Messaging, **both** Development and Production slots.
- ✅ **3. `@react-native-firebase/messaging@24.1.1`** added (matches `app`).
- ✅ **4. Config plugin** switched from android-only to the stock
  `"@react-native-firebase/app"`; `expo.ios.googleServicesFile` set.
- ✅ **5. `native/src/lib/push.ts`** registers the iOS FCM token (Android path
  unchanged; failure is swallowed so a not-yet-ready build never crashes).
- ✅ **6. EAS iOS build — DONE & VERIFIED (2026-06-26).** `eas build -p ios --profile
  production` (build `6c5e8b05-785b-4d7b-a546-e9cdfd7cb213`) finished **FINISHED** → IPA
  produced. The Firebase `messaging` pod + the stock `@react-native-firebase/app` config
  plugin **compiled clean on Expo-54 / `useFrameworks:static`** — the one real risk is
  retired, no revert needed.
- ✅ **7. TestFlight submit — DONE (2026-06-26).** `eas submit -p ios --profile production`
  uploaded **build 33** (v1.0.0) to App Store Connect (ASC API key `Y3Q8CHDC34`, stored on
  EAS). Now in Apple processing (~5-10 min) → then visible at
  <https://appstoreconnect.apple.com/apps/6778021875/testflight/ios>.
  > Note: `eas submit` is a production publish — the assistant's auto-mode classifier blocks
  > it unless the owner explicitly authorizes it in chat (or adds a Bash permission rule).
- ⏳ **8. (owner) on-device test — the only step left.** Once the build shows in TestFlight:
  install → log in → grant the notification permission → confirm a `device_push_tokens` row
  with platform `ios` appears → trigger `/api/cron/weekly-summary` (or get a missed call) →
  a lock-screen push arrives. If no iOS row appears, check `messaging().getToken()` / Firebase;
  if the row appears but no push arrives, check the APNs key in Firebase (both slots uploaded).

> ⚠️ Incoming **calls** are unaffected by any of this (separate Twilio VoIP/CallKit path).

### (historical) what enabling iOS required

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
