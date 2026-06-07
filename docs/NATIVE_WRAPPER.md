# Native app (Android / iOS) — wrapper runbook

The web app is already **native-wrapper ready** (installable PWA, mobile viewport, safe-area insets, app-like navigation). The fastest path to "downloadable on Android/iOS" is a **Capacitor** wrapper that loads the live web app, then progressively adds native capabilities (push, native dialer) later.

A `capacitor.config.json` is already in the repo, already pointing the native shell at the production URL (`appId = ai.opiflow.app`, `server.url = https://opiflow.vercel.app`). If you move to a custom domain, update both before building.

## What's already set up in this repo

- **Capacitor 7** is installed (`@capacitor/core/cli/android/ios` in `package.json`). Cap 7 needs **Node ≥ 20**; Cap 8 would force Node ≥ 22.
- **`capacitor.config.json`** points the shell at the production URL (`server.url = https://opiflow.vercel.app`, `appId = ai.opiflow.app`).
- The **Android project is scaffolded** in `android/`, with:
  - app icons + splash generated from `assets/icon.png` / `assets/splash.png`,
  - **microphone permissions** (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`) — required for in-app calls + recording,
  - an **App-Links `intent-filter`** for `https://opiflow.vercel.app` (activates once the site serves `/.well-known/assetlinks.json` — see Deep links below).
- Convenience scripts: `npm run cap:sync`, `npm run cap:assets`, `npm run cap:android`, `npm run cap:add:ios`, `npm run cap:ios`.

## Build Android (any OS with Android Studio + a JDK)

```bash
npm run cap:sync       # copy web assets + config into android/ (run after any change)
npm run cap:android    # opens Android Studio → Run on device, or Build > Generate Signed Bundle/APK (.aab)
```
The Gradle build needs a JDK / Android Studio (not installed in this repo's dev box, so the bundle is produced on your machine).

## Add iOS (needs a Mac with Xcode + CocoaPods)

```bash
npm run cap:add:ios            # creates ios/ (Mac only)
npm run cap:assets             # icons + splash for iOS
npm run cap:sync
npm run cap:ios                # opens Xcode → Product > Archive → Distribute
```
Then in Xcode add `NSMicrophoneUsageDescription` to `Info.plist` (for calls/recording) and the **Associated Domains** capability `applinks:opiflow.vercel.app`.

## Push notifications (implemented — needs FCM keys to activate)

The app **already registers for push and the server already sends it** — it is wired but **inert** until the FCM service account is set, exactly like the per-user SIP feature. This is the piece that gives the wrapper "native value" so the **iOS build can pass App Store guideline 4.2** (a pure web-view risks rejection for public release).

**How it works in code (already shipped):**
- Client: `src/lib/native/push.ts` (`registerNativePush`) runs from `AppShell` after login — on native only it requests permission and gets a **unified FCM token via `@capacitor-firebase/messaging`** (iOS AND Android — the older `@capacitor/push-notifications` returned a raw APNs token on iOS that FCM v1 rejects), then POSTs it to `/api/push/register`. Tapping a notification deep-links via `data.url`.
- Storage: migration `032_device_push_tokens.sql` (`device_push_tokens`, one row per device token).
- Server: `src/lib/server/push.ts` sends via **FCM HTTP v1** (`sendPushToUser` / `sendPushToBusinessOwner`). Already triggered when a customer **accepts/rejects an offer** or **responds to an appointment** (`/api/offer-response`, `/api/appointment-response`). Add more triggers by calling `sendPushToBusinessOwner(businessId, { title, body, url })` anywhere on the server.

**To activate (one-time):**
1. Create/open the **Firebase project** for Opiflow → Project settings → **Service accounts** → *Generate new private key* (downloads a JSON).
2. Set the server env on Vercel (either form):
   - `FCM_SERVICE_ACCOUNT_JSON` = the whole JSON (raw or base64), **or**
   - `FCM_PROJECT_ID` + `FCM_CLIENT_EMAIL` + `FCM_PRIVATE_KEY` (keep the `\n` escapes — the code restores them).
   The moment any of these is set, `isPushEnabled()` flips on and sends start flowing. Until then everything is a silent no-op.
3. **Android native build:** in Firebase add an Android app with package `ai.opiflow.app`, download **`google-services.json`** into `android/app/`, then `npm run cap:sync`. (Capacitor's push plugin pulls in the Firebase Messaging gradle bits; the `google-services.json` is the only manual file.)
4. **iOS native build (later, on the Mac/cloud-Mac):** in Firebase add an iOS app with bundle id `ai.opiflow.app`; in the **Apple Developer** portal create an **APNs auth key (.p8)** and upload it to Firebase → Cloud Messaging. Add the **Push Notifications** capability in Xcode. FCM then relays to APNs — no separate APNs send path needed.

## Submitting

- **Google Play**: create a Play Console account ($25 one-time), upload the signed `.aab`, fill store listing, roll out to internal testing first.
- **Apple App Store**: enroll in the Apple Developer Program ($99/yr), archive in Xcode, upload via TestFlight for internal testing, then submit for review.

## Important notes

- **Apple guideline 4.2 (minimum functionality):** a pure web-view wrapper can be rejected for public release. For internal pilots use **TestFlight** (no review friction). For public release, native value is needed — **native push notifications are now implemented** (`@capacitor-firebase/messaging` — unified FCM token on iOS+Android, see the Push section above) and fire on offer/appointment responses; a **native calling layer** is the next candidate.
- **Icons:** the PWA icons (`public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) and native sources (`assets/icon.png`, `assets/splash.png`) are committed, generated from `public/icon.svg` + `public/icon-maskable.svg` via `node scripts/generate-icons.cjs`. Re-run that after changing the brand mark.
- **Deep links (Universal / App Links):** the app serves the association files itself, env-gated, so taps on `opiflow.vercel.app` links open the installed app instead of the browser:
  - **iOS** — `GET /.well-known/apple-app-site-association`: set `APPLE_APP_ID` to `<TeamID>.ai.opiflow.app`, then add the Associated Domain `applinks:opiflow.vercel.app` in Xcode → Signing & Capabilities.
  - **Android** — `GET /.well-known/assetlinks.json`: set `ANDROID_SHA256_CERT_FINGERPRINTS` (comma-separated, from `keytool -list -v …` or Play Console → App signing) and optionally `ANDROID_PACKAGE_NAME` (defaults to `ai.opiflow.app`); the `<intent-filter … android:autoVerify="true">` for `https://opiflow.vercel.app` is already in `AndroidManifest.xml`.
  - Until those env vars are set the routes return **404** — no broken association is ever published. The customer token pages (`/intake/*`, `/offer-response/*`, `/appointment-response/*`, `/upload/*`) still work as plain mobile-web for recipients who don't have the app.
- **Store badges:** the landing page badges (`src/components/marketing/StoreBadges.tsx`) currently link to `/register`. Replace `PLAY_STORE_URL` / `APP_STORE_URL` with the real store URLs after publishing.
- **Auth in the wrapper:** Supabase OAuth redirects must include the app's origin. Add your production domain (and any custom scheme) to Supabase → Authentication → URL Configuration → Redirect URLs.

## Alternative: Android TWA (no Mac needed for Android)

For Android only, a **Trusted Web Activity** (via Bubblewrap) ships the PWA straight from the manifest with no web-view chrome. Good for a fast Android-first launch:

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://opiflow.vercel.app/manifest.webmanifest
bubblewrap build
```
