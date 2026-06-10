# Native calling — architecture & plan

## ✅ DECISION (session 11): Twilio Programmable Voice, behind Asterisk
After a 2nd spike (CPaaS comparison), the chosen path is **NOT** a self-hosted SIP engine
(Linphone/PJSIP — see "Rejected" below) but a **managed CPaaS Voice SDK**:

- **Provider: Twilio Programmable Voice** + the maintained Capacitor plugin
  **`@capgo/capacitor-twilio-voice`** (the ONLY CPaaS with a maintained Capacitor plugin that
  already wires PushKit/CallKit (iOS) + FCM (Android) for ring-when-killed). Telnyx is the
  documented fallback (cheaper minutes, but NO Capacitor plugin → build the native glue from zero;
  a dormant Telnyx webhook scaffold already exists in the repo).
- **Topology — keep our carrier stack:** `InterTelecom (Greek DIDs, trunk IT658318) ↔ Asterisk
  (root@46.224.138.115) ↔ Twilio SIP trunk ↔ Twilio Voice SDK (app) + Twilio-managed VoIP push`.
  Twilio's ONLY job = the mobile app leg + firing the VoIP push. It never touches the PSTN leg, so
  **per-DID caller-ID survives untouched** and `provision-asterisk.py` is reused. We do NOT port
  numbers to Twilio and do NOT point InterTelecom at Twilio directly.
- **Why Twilio over self-host:** Twilio fires the VoIP push itself (APNs VoIP cert + FCM key
  registered as a Twilio Push Credential) → **we never build Flexisip** (the part that sank the
  Linphone plan). Pure **usage-based, no flat license**.
- **AI brief: reused verbatim.** A Twilio `RecordingStatusCallback` webhook downloads the WAV and
  calls the existing `src/lib/server/openai-call-audio.ts` → `transcribeAndBriefCallAudio()`
  (Deepgram diarization → OpenAI Greek brief → task auto-gen → `communications.summary`). Do NOT
  use Twilio's built-in STT.
- **Cost (small Greek SMB, ~300 min/mo, all recorded):** ~**$7–8/mo** Twilio+AI usage + InterTelecom
  PSTN minutes (unchanged) + DID rental. **$0 upfront, no monthly minimum.**
- **Effort:** ~**5–9 weeks** to robust killed-app incoming (vs ~2.5–4 months self-hosted).

### Build phases (each a Codemagic build; MVP-first)
- **0 — De-risk (user/infra, go/no-go gates):** Twilio trunk + BYOC to InterTelecom; prove (b) a real
  outbound call presents the correct per-DID Greek CLI, and (c) `@capgo/capacitor-twilio-voice`
  receives a VoIP push on a **physical iPhone with the app KILLED**. Gate everything on (b)+(c).
- **1 — PBX coexistence:** add a Twilio PJSIP trunk + `Dial(PJSIP/twilio-mobile/biz_<id>)` branch +
  `max_contacts` bump; verify the browser WebRTC path still works alongside.
- **2 — OUTBOUND in-app calling:** add the plugin; mint a **Twilio Voice access token** from a new
  backend endpoint (VoiceGrant → TwiML App → identity `biz_<id>`); native adapter routes outbound
  through the plugin when `Capacitor.isNativePlatform()`, reusing `BrowserPhone` PhoneState.
- **3 — INCOMING (foregrounded):** Asterisk inbound DID → Twilio → Client identity → CallKit/Telecom UI.
- **4 — INCOMING (backgrounded/killed) via managed push** ← hardest: register the Twilio Push
  Credential (APNs VoIP `.p8` + FCM service-account); validate on KILLED app, physical devices.
- **5 — AI brief wiring:** Twilio recording webhook → existing `transcribeAndBriefCallAudio()`.

### What STAYS vs CHANGES
- **Stays:** InterTelecom DIDs + trunk, Asterisk + `provision-asterisk.py` per-DID CLI, the whole
  AI-brief pipeline, `communications` + timeline UI, per-user SIP model (browser), Supabase,
  codemagic.yaml, Firebase/APNs. The browser jsSIP path stays (desktop/web transport).
- **Changes/adds:** one new Asterisk PJSIP trunk to Twilio (+Dial branch, max_contacts) · a (likely
  forked) `@capgo/capacitor-twilio-voice` plugin in the shell · a new Twilio-token endpoint · a new
  Twilio recording webhook. The native app uses Twilio Client identities `biz_<id>` instead of raw SIP.

### Owner action items (Phase 0, gating)
1. Create a **Twilio account** → an **API Key/Secret**, a **TwiML App** (for the VoiceGrant), and an
   **Elastic SIP Trunk** (BYOC) wired to InterTelecom↔Asterisk.
2. Register a **Twilio Push Credential**: upload the **APNs VoIP `.p8`** (Key ID + Team `7Q7A3NFK8T`,
   bundle `ai.opiflow.app`) + the **FCM service-account** key.
3. Set Vercel env: `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID`,
   `TWILIO_PUSH_CREDENTIAL_SID` (the assistant cannot handle the raw secrets).
4. Provide a **physical iPhone + Android** for killed-app push validation.

---

## ✅ INBOUND calling — code wired (web app) + owner runbook

**What the app code already does (no further app build logic needed for the happy path):**
- `GET /api/phone/twilio-token` mints a Voice token with `incomingAllow:true` **and** the
  platform-correct `pushCredentialSid` (the client sends `?platform=ios|android`; the server
  picks `TWILIO_PUSH_CREDENTIAL_SID_IOS` / `_ANDROID`, falling back to `TWILIO_PUSH_CREDENTIAL_SID`).
- **NEW** `POST /api/webhooks/voice/twilio/inbound` returns `<Dial><Client>biz_<id></Client></Dial>`
  — records the leg (→ existing AI-brief pipeline) and passes the caller's number as the in-app
  caller-ID. Signature-validated with `TWILIO_AUTH_TOKEN` + `TWILIO_INBOUND_WEBHOOK_URL`.
- The app **registers for incoming + VoIP push at launch** (`AppShell → registerNativeVoiceForPush()`),
  not just inside the Settings test panel. The `@capgo/capacitor-twilio-voice` plugin self-configures
  **PushKit (iOS)** and **FCM full-screen-intent (Android)**, so the **system incoming-call UI shows
  even when the app is backgrounded/killed**. No AppDelegate change needed (the plugin's iOS code
  already implements `PKPushRegistry` + CallKit `reportNewIncomingCall`).

**Owner steps to make it actually ring (one-time, ~an afternoon):**
1. **Twilio Push Credential** — the piece that wakes a killed app:
   - **iOS:** Apple Developer → Keys → create an **APNs *VoIP* key** (`.p8`); note Key ID + Team
     `7Q7A3NFK8T`, bundle `ai.opiflow.app`. Twilio Console → Voice → **Push Credentials → Create →
     APNs (VoIP)**, upload the `.p8`. → set `TWILIO_PUSH_CREDENTIAL_SID_IOS` on Vercel.
   - **Android:** Twilio → Push Credentials → Create → **FCM**, paste the **FCM v1 service-account
     JSON** (same Firebase project as `google-services.json`). → set `TWILIO_PUSH_CREDENTIAL_SID_ANDROID`.
   - (Validate ONE platform end-to-end first; add the second after.)
2. **Twilio SIP Domain** — carrier → app entry point:
   - Twilio → Voice → **SIP Domains → Create** (e.g. `opiflow.sip.twilio.com`).
   - Voice Configuration → **Request URL (POST) = `https://www.opiflow.ai/api/webhooks/voice/twilio/inbound`**.
   - Add the Asterisk IP to the domain's IP-ACL (+ a credential list if you require auth).
   - Set `TWILIO_INBOUND_WEBHOOK_URL` on Vercel to that exact URL (for signature validation).
3. **Asterisk inbound dialplan** — DID → Twilio → app (in `provision-asterisk.py` / inbound context).
   Add a PJSIP trunk endpoint to `opiflow.sip.twilio.com`, then fork the DID to the app identity:
   ```
   exten => <DID>,1,NoOp(Inbound ${EXTEN} → app biz_<id>)
    same => n,Dial(PJSIP/biz_<id>@twilio-inbound,30)
    same => n,Hangup()
   ```
   Keep the existing browser-WebRTC + Viber paths untouched (additive). To ring BOTH the app and a
   browser session, `Dial()` both in one command separated by `&`.
4. **Device test** (physical iPhone **and** Android — VoIP push does **not** work in simulators):
   install the latest Codemagic build, log in (auto-registers), **lock the phone**, call the DID →
   it should ring on the lock screen showing the customer's number → answer → 2-way audio → hang up
   → the recording webhook fires the AI brief into the customer's timeline.

**Still TODO after the above rings (polish, separate):** map the inbound caller number → CRM customer
and deep-link the operator to that chat on answer; surface in-call UI in the web layer (today the
native CallKit/Telecom UI handles answer/mute/hangup); add an inbound `communications` row at
call-time (the recording webhook already adds the brief).

---

> ## Rejected alternative (kept for context): self-hosted SIP engine (Linphone/PJSIP)
> Output of the FIRST architecture spike. **Two hard blockers** made this the wrong path.

## TL;DR
The Capacitor app is a **remote-URL WebView** (`server.url = https://opiflow.vercel.app`).
Everything works in it **except in-app calling**: WebRTC `getUserMedia` (mic) is blocked in
the iOS WKWebView for remote content. Real in-app calling must move to a **native SIP engine**
in the app shell, bridged to the existing web UI. That is a **~2.5–4 month** effort and needs
**a paid SIP license + extra PBX infra (push gateway)** — neither is "free".

## 🚧 Blocker 1 — LICENSE (Linphone is NOT free for a closed-source store app)
- liblinphone / linphone-sdk is **AGPL/GPLv3**. Linking it into a closed-source App Store / Play
  binary effectively forces open-sourcing the whole app (plus the known GPL-vs-App-Store-ToS
  conflict). `-DENABLE_GPL_THIRD_PARTIES=NO` does **not** relicense the core.
- ⇒ A **commercial Belledonne license** is required (cost via quote), OR switch engine.
- Alternatives: **PJSIP** (dual-license, public pricing) · **Acrobits SDK** (commercial, but its
  SaaS *includes* the VoIP push gateway — removes the hardest part below).

## 🚧 Blocker 2 — INCOMING-CALL PUSH (self-hosted Asterisk can't do VoIP push)
- iOS requires a PushKit VoIP push → immediate CallKit `reportNewIncomingCall`, or iOS kills the
  app. Asterisk 20 cannot read RFC 8599 push params or fire APNs/FCM on an inbound INVITE.
- Options: **(A) Flexisip push-gateway** in front of Asterisk (recommended for self-host) ·
  (B) custom token-service + AMI/AGI dialplan hook · (C) paid proxy.
- **Acrobits avoids this entirely** (managed push) — a major reason to reconsider it vs Linphone.

## Architecture (engine-agnostic)
- Custom **Capacitor plugin** (`ai.opiflow.plugins.<engine>`) holds the SIP engine + CallKit (iOS)
  + Telecom/ConnectionService (Android) + PushKit/FCM. The web UI (`src/components/phone/BrowserPhone.tsx`,
  `calls/page.tsx`) keeps the SAME `PhoneState`/`CallEndedEvent` contract; a native adapter swaps
  the jsSIP transport for the plugin when `Capacitor.isNativePlatform()` (mirrors `src/lib/native/push.ts`).
- Creds: reuse `GET /api/phone/browser-token` (`biz_<id>` + secret). Never persist the SIP password.

## PBX changes (additive — needed for ANY native SIP engine)
- New `[transport-tls]` (TCP **5061** + Hetzner firewall) using the existing OPIFLOW TLS cert.
- `provision-asterisk.py`: emit a 2nd per-business endpoint `[biz_<id>_native]` — `transport-tls`,
  `media_encryption=srtp` (SDES, not DTLS/WSS), `allow=ulaw,alaw`, shared `auth`/`aors`.
- Bump aor `max_contacts` 1→2 so browser + native register together; inbound DID forks to both.

## Phases (each an independently shippable Codemagic build)
- **0 — Decision spike** (no app code): license quote + push-origin choice + prove TLS/SRTP register
  from a DESKTOP Linphone to a temp endpoint.
- **1 — PBX coexistence**: TLS transport + `[biz_<id>_native]` endpoint + max_contacts=2. Verify the
  browser WebRTC path still works AND a desktop SIP client rings on the DID simultaneously.
- **2 — Plugin skeleton + REGISTER** (1st mobile build): register()/event bridge, creds from API.
- **3 — Outbound + system UI + mic**: call()/hangup(), CallKit / ConnectionService, mic perms, audio routing.
- **4 — Inbound (foregrounded)**: incoming INVITE → CallKit/Telecom incoming UI → accept/decline.
- **5 — Inbound (backgrounded/killed) via VoIP push** ← **hardest, ~bulk of the risk**: Flexisip
  push-gateway, iOS PushKit→reportNewIncomingCall, Android FCM data→foreground service→Telecom.

## Risks
- License (blocker). Backgrounded-incoming push reliability (locked/killed). Remote-URL shell means
  every call-engine change needs store review. +double-digit MB binary. PBX interop (native SRTP/TLS
  must not break browser WebRTC). App Store VoIP/PushKit scrutiny. **~2.5–4 months to robust prod.**

## Decisions needed (product owner)
1. **Engine/license:** Acrobits (commercial, bundles push) · Linphone commercial license · PJSIP (public pricing). "Linphone free" is not an option for closed-source.
2. **Push origin:** Flexisip push-gateway on the Hetzner box (if self-host) vs Acrobits-managed.
3. **Scope/budget:** approve the ~2.5–4 month native effort (phase 5 = most of the risk).
4. **Platform priority:** Android first (faster, less strict) or iOS first.

## Reality check
Everything EXCEPT in-app calling already works in the shipped app. Until calling is decided, the
pragmatic interim is the device's native dialer (`tel:`) for outbound (loses Opiflow caller-ID +
recording), or defer calling and ship the rest.
