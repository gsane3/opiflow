# Android release & Firebase/FCM connect (Opiflow)

Status (verified 2026-06-17): the Expo app already ships Android config — package
`ai.opiflow.app`, committed `native/google-services.json` (Firebase project
`opiflowai`), the Android-only Firebase plugin (`plugins/withFirebaseAndroidOnly.js`),
and all permissions (RECORD_AUDIO, CAMERA, READ_CONTACTS, POST_NOTIFICATIONS,
USE_FULL_SCREEN_INTENT). `eas.json` production now builds an **app-bundle (.aab)**
for Play (preview stays `.apk` for sideload testing).

What's left is **owner-side** (accounts/credentials the assistant can't create).

---

## 1. Rebuild Android with the latest code ("βάλε τα updates")

The current APK predates the L1–L5/L7 fixes. Build a fresh artifact from `master`:

```bash
cd native
# Play production (AAB, auto-increments versionCode):
EAS_NO_UPDATE_NOTIFIER=1 eas build -p android --profile production
# OR a quick sideload APK to test on a device first:
EAS_NO_UPDATE_NOTIFIER=1 eas build -p android --profile preview
```

The app marketing version is `1.0.0` (app.json). Bump it before the FIRST public
Play release if you want a clean store version string.

## 2. Connect your Play Console account ("connect το play console account")

`eas.json` → `submit.production.android` expects `./play-service-account.json`
(NOT committed — it's a secret). To create it:

1. Google Play Console → your app (create it, one-time $25) → **Setup → API access**
   (or Google Cloud console) → create a **service account** with the
   *Service Account User* role and grant it access to the app in Play Console
   (Users & permissions → invite the service-account email → Release permissions).
2. Create + download a **JSON key** for that service account.
3. Save it as `native/play-service-account.json` (it's already gitignore-safe —
   keep it out of git; never commit it).
4. Submit the AAB:
   ```bash
   cd native
   eas submit -p android --latest          # or --id <build-id>
   ```
   Track defaults to `internal`. Promote to `production` in the Play Console after testing.

You still need to complete in the Play Console **before production rollout**:
store listing (title/short+full desc, feature graphic, phone screenshots),
**Data Safety** form (declare RECORD_AUDIO, READ_CONTACTS, CAMERA, customer PII,
call summaries; encryption in transit), content-rating questionnaire, and accept
Play App Signing (note its **SHA-256 cert fingerprint** — needed for App Links, §4).

## 3. Firebase / FCM for INCOMING calls on Android ("δεν τα συνδέσαμε με firebase")

Firebase project `opiflowai` + `google-services.json` already exist. The missing
link is telling **Twilio** how to push VoIP call invites to Android via FCM:

1. Firebase console → project `opiflowai` → ⚙ Project settings → **Cloud Messaging**.
   - Make sure the Android app `ai.opiflow.app` is registered (it is, per google-services.json).
   - Under **Service accounts**, generate a private key (FCM v1) — a JSON key file.
2. Twilio console → Voice → **Push Credentials** → *Create new Credential* →
   type **FCM** → paste the FCM v1 service-account JSON (or the legacy server key).
   Copy the resulting Credential SID (`CRxxxx…`).
3. Vercel → Project → Settings → Environment Variables (Production):
   `TWILIO_PUSH_CREDENTIAL_SID_ANDROID = CRxxxx…`
   (The app already sends `platform=android` to `/api/phone/twilio-token`; today it
   falls back to the iOS APNs credential, which can never reach Android — that's
   why Android doesn't ring.)
4. Rebuild (§1) if you regenerated `google-services.json`, install on a real
   Android device, sign in, kill the app, and place a test inbound call to the
   business DID — it should ring via CallKit-equivalent (ConnectionService).

## 4. (Optional) Android App Links — opening opiflow.ai links in the app

Deliberately NOT wired yet: a blanket autoVerify on `opiflow.ai` would hijack the
**customer portal** links (`/f/...`) into the technician app (which has no such
route). If you later want technician deep-links, scope `android.intentFilters`
(app.json) + iOS `associatedDomains` to specific paths only, and set the web env:
`APPLE_APP_ID = 7Q7A3NFK8T.ai.opiflow.app` and
`ANDROID_SHA256_CERT_FINGERPRINTS = <Play App Signing SHA-256>` so the
`/.well-known/apple-app-site-association` + `/.well-known/assetlinks.json` routes
publish.
