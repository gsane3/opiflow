# Opiflow native — EAS build → iPhone

Get the real native app onto your iPhone via Expo's cloud build (no Mac needed).
Run everything from `E:\yorgos\native`.

**Prereqs:** a free Expo account (https://expo.dev) · your Apple Developer account.

## 1. Tooling + login + link
```
npm i -g eas-cli
eas login
npx expo install expo-dev-client
eas init
```
`eas init` links the project and writes `extra.eas.projectId` into `app.json`.

## 2. Set the public Supabase anon key for cloud builds (once)
The cloud build has no local `.env`, so set the public anon key as an EAS env var:
```
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "PASTE_ANON_PUBLIC_KEY" --visibility plaintext --environment development --environment preview --environment production
```
(Same value as in `native/.env`; Supabase → Settings → API → `anon` `public`. The
URL already has a default in code.)

## 3. Register your iPhone (for development / ad-hoc builds)
```
eas device:create
```
Open the link/QR on the iPhone → install the profile → the device is registered.

## 4. Build the iOS dev client (~15–20 min, in the cloud)
```
eas build --profile development --platform ios
```
When prompted, log into Apple — EAS creates the signing credentials for App ID
`ai.opiflow.app` + a development provisioning profile that includes your device.

## 5. Install + connect
- When the build finishes, EAS prints a URL/QR → open it on the iPhone → **Install**
  the "Opiflow" dev client.
- Back here: `npx expo start --dev-client` → open the Opiflow app on the phone → it
  connects to Metro and loads the real native app (4 native tabs, customers, dialer).

## Next
Once this works, we add the **Twilio native calling** module and rebuild (step 4
again) to test real incoming/outgoing calls with CallKit.
