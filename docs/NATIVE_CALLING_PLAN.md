# Native calling — architecture & plan (decision-gated)

> Output of the session-11 architecture spike (web research + repo mapping).
> **Two hard blockers must be decided before ANY native call code is written.**

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
