# Opiflow — Project State & Log (canonical)

> **This is the always-current source of truth for the Opiflow project.**
> Read it first at the start of every session. **Update it before every `/compact`**
> and after any significant change (infra IDs, changelog, current state, blockers,
> plan, loose ends). It lives in the repo, so it survives folder/repo renames.
> A private cross-session copy of the gist also lives at
> `~/.claude/projects/<proj>/memory/project_yorgos_ai.md`.
>
> **Last updated:** 2026-06-09 — session 12 — **🎨 UX/UI REDESIGN (phone-first messenger) STARTED.** Full grounded plan in **`docs/REDESIGN_PLAN.md`**. **DB migrations 037–042 ALL APPLIED** in the SQL editor (status 7→4 = `new/in_progress/won/lost`; `call_briefs` append timeline + `communications.provider_call_id`; `service_catalog_items`; `suggested_actions`; `tasks.start_at/end_at`; WhatsApp dropped). **The WHOLE phone-first UI redesign is FUNCTIONALLY DONE + POLISHED through PR #100** (26 PRs #75–#100). **Live flow:** Πελάτες → tap → **Messenger chat** (bubbles, call→AI brief, clickable replies) → **ⓘ info panel** (all sections always-visible, editable contact, gallery, offers/appointments lists, reject) → **➕ composer** (offer w/ catalog + per-line autosuggest · ραντεβού · ζήτα στοιχεία/φωτο). **Αρχική** chips (Ραντεβού / Να-πάρω-τηλέφωνο popups) · **Κλήσεις** (auto-on recording + customer search) · **Settings 6-cat** + **Κατάλογος υπηρεσιών**. Dates = **DD-MM-YYYY** (`src/lib/date.ts`). **#100 = top-agency UI/UX polish pass** (8-agent audit → apply, 17 files, visual-only: ONE stroke-icon family [all emoji→SVG], 16px inputs, ≥44px targets, Badge status tones, entrance/press motion, ui/* primitives, active-nav pill, centered AI FAB). The old `customers/[id]` stacked-card page still exists (reached only by direct URL — nothing links to it) → retire later. **🎙️ AI voice assistant = disabled placeholder; native inbound calling NOT built.** **⏭️ NEXT (need owner decisions/external setup): P5** voice AI (STT provider+cost decision Deepgram/OpenAI + native mic + expanded `/api/ai/cmd` intents) · **P6** native engine (inbound-when-closed: Twilio SIP Domain + Push Credential, Apifon Viber-sender approval, iOS PushKit, device testing) · minor refinements (offer/appointment open-from-info, LLM-driven suggested_actions, AI/file catalog import, timeslot calendar). ──────── PRIOR (session 11): (**🍏 iOS LIVE on TestFlight** PRs #52–#58 + **login-first native gate** #62 + **B3** #50 + **per-business email-identity** Phase 1 + **🎙️ NATIVE-CALLING DECISION LOCKED: Twilio Programmable Voice behind Asterisk** — `docs/NATIVE_CALLING_PLAN.md`). **🟢 OUTBOUND native calling WORKING on Android** (PRs #64–#70): app (Twilio Voice SDK via `@capgo/capacitor-twilio-voice@7.1.0`) → Twilio TwiML → Asterisk `from-twilio` → InterTelecom, Greek DID caller-ID. Test in **Settings → «Δοκιμή κλήσης»** (native-only `NativeCallTestPanel`). Twilio kept BEHIND Asterisk → InterTelecom DIDs + per-DID CLI + AI-brief pipeline untouched. **iOS OUTBOUND fixes MERGED but NOT yet uploaded** (#70 mic+bg modes, **#72** mic via `plutil` — the Greek PlistBuddy value was silently dropped = the real "no mic prompt" blocker; panel no longer waits for `registrationSuccess` which never fires on iOS [Capgo plugin has no PushKit] yet `login()` succeeds + outbound works; **#73** CFBundleVersion=epoch — each TestFlight upload must increment). **⏭️ IMMEDIATE NEXT ACTION: run a FRESH iOS Codemagic build on master `cc9e534` → new CFBundleVersion uploads → TestFlight → update on iPhone → test «Δοκιμή κλήσης».** TestFlight currently has ONLY the old build «1» (Jun 8 5:49 PM); none of the voice builds uploaded yet (#9 failed on the duplicate version). **iOS outbound needs NO Push Credential / entitlements / AppDelegate changes** (verified in plugin source). **Owner set on Vercel:** `TWILIO_ACCOUNT_SID/AUTH_TOKEN/API_KEY/API_SECRET/TWIML_APP_SID` + `TWILIO_OUTBOUND_SIP_DOMAIN=46.224.138.115:5060` + `TWILIO_OUTBOUND_WEBHOOK_URL`/`TWILIO_RECORDING_WEBHOOK_URL` (www.opiflow.ai). **⏭️ NEXT:** iOS test · INBOUND (Asterisk→Twilio SIP Domain→`<Dial><Client>`→app, needs a Twilio SIP Domain + inbound TwiML endpoint + Asterisk dial-to-Twilio) · closed-app VoIP push (Twilio Push Credential = APNs VoIP `.p8` + FCM) · wire BrowserPhone to the plugin (replace the test panel). Rejected self-hosted Linphone (GPLv3 + self-host push). **PUSH on iOS is server-ready (`push:true`); APNs key confirmed Sandbox&Production.** **⚠️ `/api/health` gaps for full function: `email:false` (set `RESEND_API_KEY`+`EMAIL_FROM`) and `openai:false` (set `OPENAI_API_KEY`).** The app is a **remote-URL WebView** (`server.url=https://opiflow.vercel.app`); everything works EXCEPT in-app calling. Earlier session 9: **TELEPHONY MULTI-DID LIVE** + **CALL-FLOW v2** (missed-call labels, hybrid intake-link prompt, preferred-channel sends + Viber→SMS, Deepgram diarization, 1h reminder cron); UX/CAM redesign + customer-detail v2 + Vercel `sharp` fix. **Blocker F.3 RESOLVED.** Migrations **033/034/035 APPLIED**; **036 PENDING (apply in Supabase SQL editor)**. `SIP_CRED_ENC_KEY`+`CRON_SECRET`+`DEEPGRAM_API_KEY` set on Vercel; **hourly PBX cron live**. **Pending (external): Apifon SMS sender «opiflow» approval → `APIFON_SMS_SENDER`; InterTelecom on-demand DIDs reply; Apifon WhatsApp/SMS automation reply. Optional: set `SENTRY_DSN` to activate Sentry.**

---

## A. What Opiflow is
Greek, **mobile-first business-phone + CRM** for service technicians (HVAC first).
Positioning: **Customer Action Management (CAM)** — "from CRM to CAM". Every call
→ customer record + AI brief + next action; the tech sends the customer a Viber
link (intake / photos / offer / appointment); the customer answers on public token
pages (`/intake/[token]`, `/offer-response/[id]`, `/appointment-response/[id]`, `/upload/[token]`).
- Name history: **yorgos / smartpi → deskop → Opiflow** (current).
- Brand: emerald `#00C499` (primary), royal blue `#3361FF` (secondary), dark navy
  `#0A1120`; wordmark "opiflow.ai"; **light theme**.

## B. Live infrastructure — CANONICAL (verify here, do not trust older notes)
| Thing | Value |
|---|---|
| Live app | **https://opiflow.vercel.app** |
| Vercel project | **`sane127/opiflow`** (CLI logged in as `georgiostsipos-2366`) |
| Supabase project (LIVE) | **`oluhmztfimmgmbxoioea`** → https://oluhmztfimmgmbxoioea.supabase.co (confirmed in the deployed client bundle) |
| GitHub repo | `github.com/gsane3/yorgos` — **TO RENAME → `opiflow`** |
| Local folder | `E:\yorgos` — **TO RENAME → `E:\opiflow`** |
| PBX | Hetzner CPX22, Ubuntu 24.04, **`root@46.224.138.115`**, Asterisk 20.6 active |
| Trunk | InterTelecom `IT658318`; WebRTC transport **WSS :8089**; TLS `/etc/asterisk/tls/` |
| Shared SIP user | `yorgospro001` (= app's `PHONE_SIP_USERNAME`) + `groundwire001` (interim mobile) |
| Health | `GET /api/health` (booleans only) |

> ⚠️ **`hgboywgjddphzeiwtezw` is the OLD Supabase project — safe to DELETE.** The live
> app's deployed bundle uses `oluhmztfimmgmbxoioea`. **BUT the local `.env.local` is STALE:
> it still holds the OLD `hgboy` keys**, and the PBX `/etc/opiflow/sip.env` was seeded from
> it → the PBX currently points at the dead `hgboy`. **Fix: update `.env.local` to the
> `oluhmzt` keys, then re-ship the new service key to the PBX.** The "031 missing / 0 rows"
> earlier was just because we were querying the dead `hgboy` — 031 + data live on `oluhmzt`.
> Also delete the old Vercel project `yorgos` (→ `directsourcing.gr`) only if truly unused.

## C. Stack & architecture
- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind v4.
- Supabase `@supabase/supabase-js`: anon client (RLS) + service-role server client.
- Auth: client-side (`AppShell` getSession → `/login`); every API route re-checks the
  Bearer token; tenancy = `businesses.owner_id`; shared helper `authenticateBusinessRequest`.
- Telephony: browser **jsSIP** over the Asterisk WSS gateway; InterTelecom trunk;
  native background calling (CallKit/PushKit + Acrobits SDK) = **future**.
- Capacitor wrapper: appId `ai.opiflow.app`.
- Migrations: `supabase/migrations/NNN_*.sql` applied **manually via the Supabase SQL
  editor** (NOT Supabase-CLI timestamp format — do not `supabase db push`).

## D. Changelog (newest first)
- **2026-06-09 — session 12 — 🎨 UX/UI REDESIGN (phone-first messenger) — plan + P0/P1 + P2a/P2b:**
  - **Plan (`docs/REDESIGN_PLAN.md`):** grounded build plan from a multi-agent codebase pass — data deltas, API deltas, component reuse/new/retire, Track A (UI, buildable now) vs Track B (native calling/recording engine), phases P0–P6. Locked product decisions: **Messenger-style customer card** (chat bubbles + info panel), **AI assistant floating everywhere** (general from home / customer-scoped from card), **4-tab nav**, comm **waterfall Viber→SMS→email** (WhatsApp dropped), **missed call → auto** waterfall / **answered → ask**, **recording auto-on + spoken consent** (consent prompt = P6), **service catalog** (new, team-shared), **statuses 7→4**, **calendar day-view + swipe**, **settings 6 categories**.
  - **#75 — P0+P1 foundation (migrations 037–042 + status lockstep + brief timeline):** 6 migrations. Status simplified to `new/in_progress/won/lost` via a **broad-compatible union** (legacy values kept as deprecated so retire-bound screens still compile; writers/validation/AI emit only the 4 new). New **`call_briefs`** append table fixes a real silent-drop bug (the recording pipeline used to OVERWRITE the metadata brief). New **`communications.provider_call_id`** for exact Twilio recording matching (was a fragile `summary LIKE` scan, never stamped → briefs dropped). `appendCallBrief()` wired into calls/log, calls/recording, twilio/recording, pbx-recording. **Applied 037–041** in the SQL editor (039 needed a *drop-before-remap* reorder — the old CHECK rejected the new values mid-migration; **042 was run by mistake then reverted** → whatsapp re-allowed until P2c). `tsc`+vitest 22/22+`next build` green.
  - **#76 — P2a (nav):** `BottomNav` → 4 tabs + AI floating FAB (removed the Βοηθός tab + «Περισσότερα» sheet); `DesktopSidebar` → 3 items + Ρυθμίσεις + logout; logout also added to the Settings landing; `customers` list dropped its 3-tile stats strip. Tasks/Appointments/Offers/Stats/Search are no longer nav destinations.
  - **#77 — P2b (Κλήσεις):** removed the inline recording toggle + consent modal + mic-check card; **recording AUTO-ON** by default (`deskop_record_calls` defaults on); moved a recording on/off switch + mic-permission check into **TelephonyPanel** (Settings→Τηλεφωνία).
  - **#78 —** removed a stray 0-byte junk file committed by `git add -A`.
  - **#80–#86 — P3 Messenger customer card (the centerpiece, FUNCTIONALLY DONE):** **#80 P3a** `GET /api/customers/[id]/timeline` (unified chat stream, derived from 8 sources) + `/offers/summary`. **#81 P3b** `MessengerTimeline` chat bubbles (our side right / customer left; call→AI brief) + route `/customers/[id]/chat`; **#82** fit-viewport (composer always visible, only messages scroll); **#83** `CustomerCard` opens the chat → **Messenger is the default customer surface**. **#84/#85 P3c info panel** (ⓘ slide-over, ALL sections, no old-card link): contact +Google Maps, aggregated offers, AI call-brief timeline, **media gallery** (customer photos/videos → FileGallery lightbox), **editable internal note**, **reject customer**. **#86 P3c-2 ➕ composer** (bottom sheet): **Ζήτα στοιχεία / Ζήτα φωτο** = real sends via the customer's preferred channel (Viber→SMS), **Κλείσε ραντεβού** = inline date/time → `book_appointment` task; **Στείλε προσφορά** flagged «σύντομα — με τον κατάλογο».
  - **#88–#90 — P4 service catalog + offer composer + home chips (DONE):** **#88 P4a** catalog CRUD API (`/api/catalog` + `/api/catalog/[id]`, soft-delete) + **ServiceCatalogPanel** in Settings (team-shared price list). **#89 P4b** the chat ➕ composer's **offer builder** (catalog search → priced line items + VAT + live total → `POST /api/offers`), completing all 4 ➕ actions (offer / appointment / request-details / request-photos). **#90 P4c** dashboard **«Τι έχω για σήμερα;» chips**: «[#] Ραντεβού» agenda popup + «Να πάρω τηλέφωνο [#]» call-back list, tap → Messenger chat.
  - **#92–#93 — P2c (DONE):** **#92** removed WhatsApp as a channel (SendChannelSheet button + intake form option + intake/customers API allow-lists) → **migration 042 APPLIED** (CHECK back to viber/sms/email/phone). **#93** Settings reorganized into **6 categories** (Επιχείρηση / Τηλεφωνία / Κατάλογος / Δεδομένα / Λογαριασμός / Ειδοποιήσεις) + Στατιστικά row; dropped the «Πάροχοι» teaser; panels live inside their category.
  - **#95–#100 — P3/P4 refinements + AI chips + dates + UI/UX polish (DONE):** **#95** heuristic **AI suggested-action chips** in the chat (no offer → «Δημιουργία προσφοράς», no appointment → «Κλείσε ραντεβού» → open the ➕ at that action). **#96** **customer-search bar** at the top of Κλήσεις (→ chat). **#97** **info panel v2** — ALL sections always visible with empty states, **editable contact** (name/company/mobile/landline/email/address + Save), offers/appointments lists; **clickable chat bubbles**: call→brief popup (or «Δεν βρέθηκε περίληψη»), photos→gallery, intake→info▸contact, appointment→info▸appointments, offer→info▸offers. **#98** ➕ menu → elegant 4-tile horizontal popover + **per-line catalog autosuggest** in offers (type «S50» → Alumil Smartia S50 + code + price). **#99** dates standardized to **DD-MM-YYYY** (shared `src/lib/date.ts`). **#100** **top-agency UI/UX polish pass** (8-agent audit → 8-agent apply, 17 files, visual-only): one stroke-icon family (all emoji → SVG), 16px inputs, ≥44px targets, Badge status tones, entrance/press motion, Spinner/EmptyState/Button/Input primitives, active-nav pill, centered AI FAB. tsc + vitest **79/79** + build green.
  - **🟢 STATE:** the **whole phone-first UI redesign is functionally DONE + polished**. **Migrations 037–042 ALL APPLIED.** Old `customers/[id]` page still exists (direct-URL only) → retire later.
  - **⏭️ NEXT (need owner decisions/external setup):** **P5** AI assistant voice (🎙️ are placeholders — needs STT provider+cost decision [Deepgram/OpenAI] + native mic + expanded `/api/ai/cmd` intents incl. send-offer-with-catalog + Siri-like popup). **P6** native engine (inbound-when-closed via Twilio SIP Domain + Push Credential + server recording + spoken GDPR consent + auto missed-call waterfall — external blockers: iOS PushKit, Apifon Viber-sender approval, device testing). **Minor refinements:** open/edit an offer or appointment in FULL from the info panel (now list-only), LLM-driven `suggested_actions` (table 041 ready, heuristic for now), AI/file catalog import, true day-timeslot calendar (now an agenda list), appointment duration UI (`tasks.start_at/end_at` migrated, unused), retire SendViaViberModal + the old customer page.
- **2026-06-08/09 — session 11 (cont.) — iOS outbound debugging (#72, #73) — fixes MERGED, fresh build pending:**
  - **#72** root-caused via reading the Capgo plugin iOS source (workflow): (a) the Greek `NSMicrophoneUsageDescription`
    was **silently dropped** — `PlistBuddy -c "Add ... string <multi-word/UTF-8>"` re-tokenizes the value → empty key →
    iOS killed the mic request (no prompt, no Microphone row in Settings, call rejected before connect). Fixed with
    `plutil -replace NSMicrophoneUsageDescription -string "…"` + a `VERIFY` echo. (b) The plugin **never fires
    `registrationSuccess` on iOS** (it has no PushKit) but `login()` still succeeds and OUTBOUND works — the test
    panel wrongly waited for the event → now treats `login()`'s return as readiness. **iOS outbound needs NO Push
    Credential / entitlements / AppDelegate changes** (incoming-when-closed is a later phase that WILL).
  - **#73** CFBundleVersion bumped to epoch seconds — `cap add ios` regenerates `CFBundleVersion=1` each build, so the
    2nd TestFlight upload was rejected ("bundle version must be higher than '1'"). Now every upload is unique.
  - **STATE:** master `cc9e534`. The fixes are merged but **no fixed iOS build has uploaded yet** — TestFlight shows only
    the old build «1» (#9 built+signed fine but FAILED upload on the duplicate version, before #73). **NEXT: start a
    fresh iOS build on `cc9e534`** → it uploads → processing → TestFlight update → test outbound on iPhone.
  - **🔐 `.gitignore`** now also blocks `*recovery*code*.txt` (a Twilio 2FA recovery-code file was sitting untracked in
    the repo root — owner should move it OUT of the repo).
- **2026-06-08 — session 11 (cont.) — 🟢 OUTBOUND native calling WORKING on Android (PRs #64–#70):**
  - End-to-end outbound: app (`@capgo/capacitor-twilio-voice@7.1.0`, Cap7) → Twilio Voice → TwiML App
    (`/api/webhooks/voice/twilio/outbound` resolves the business Greek DID from the `client:biz_<id>` identity,
    `<Dial callerId=DID><Sip>` to Asterisk) → Asterisk **`from-twilio`** context → `intertelecom` trunk → customer.
    **Tested working on Android.** Caller-ID = OPIFLOW_DID (no `+`, InterTelecom-trusted).
  - **PBX (live, SSH, backed up `before-twilio-*`):** added a Twilio-trusted `[twilio]` PJSIP endpoint
    (`[twilio-identify]` match Twilio EU signaling IPs 54.171.127.192/30 + 35.156.191.128/30) + `[from-twilio]`
    dialplan → InterTelecom. **Browser WebRTC path verified intact.** Firewall already open (5060/udp + RTP
    10000-20000/udp to Anywhere).
  - **App:** `src/lib/native/twilio-voice.ts` (dynamic-import adapter, web no-op) + Settings `NativeCallTestPanel`
    («Δοκιμή κλήσης», native-only) that registers with a Twilio token (`/api/phone/twilio-token`) and places a
    test call WITHOUT touching BrowserPhone's jsSIP path.
  - **#70:** iOS Info.plist gets NSMicrophoneUsageDescription + UIBackgroundModes (audio, voip) for the iOS build.
  - **Twilio account:** pay-as-you-go, $20 funds, TwiML App `opiflow-voice` (Voice URL → the outbound endpoint),
    API Key `opiflow`. Owner set the `TWILIO_*` + `TWILIO_OUTBOUND_SIP_DOMAIN=46.224.138.115:5060` envs on Vercel.
  - **⏭️ NEXT:** iOS test · INBOUND (Twilio SIP Domain + inbound `<Dial><Client>` TwiML + Asterisk dial-to-Twilio)
    · closed-app VoIP push (Twilio Push Credential) · wire BrowserPhone to the plugin (retire the test panel).
- **2026-06-08 — session 11 (cont.) — 🎙️ NATIVE-CALLING decision LOCKED + Twilio foundation:**
  - **Two architecture spikes** (multi-agent workflows). First rejected self-hosted SIP (Linphone GPLv3 →
    needs a paid commercial license for a closed-source store app; self-host VoIP push needs Flexisip = too
    hard). Second chose **Twilio Programmable Voice + the maintained `@capgo/capacitor-twilio-voice` plugin**,
    kept **BEHIND Asterisk**: `InterTelecom (Greek DIDs) ↔ Asterisk ↔ Twilio SIP trunk ↔ Twilio Voice SDK +
    Twilio-managed VoIP push`. Twilio only does the app leg + fires the push → **per-DID caller-ID + the whole
    AI-brief pipeline are reused unchanged**, no self-hosted push gateway. **~$7–8/mo usage, $0 upfront, ~5–9
    weeks** in 6 phases. Full plan + owner Phase-0 checklist in **`docs/NATIVE_CALLING_PLAN.md`**.
  - **Foundation shipped (env-gated/inert):** **#64** `GET /api/phone/twilio-token` (mints a Twilio Voice
    access token, VoiceGrant→TwiML App→identity `biz_<id>`) + `twilioVoice` health integration + `twilio@6`.
    **#65** `POST /api/webhooks/voice/twilio/recording` (downloads the WAV, reuses `transcribeAndBriefCallAudio()`
    → Greek brief → ai_draft task; matches communications by `twilio_sid=<CallSid>`).
  - **⏳ NEXT (Phase 1+, mostly blocked on the owner's Twilio account):** PBX `provision-asterisk.py` gains a
    Twilio PJSIP trunk + `Dial(PJSIP/twilio-mobile/biz_<id>)` + max_contacts bump; install/fork the Capgo plugin
    + native adapter in `BrowserPhone` (swap jsSIP→plugin when `Capacitor.isNativePlatform()`); register the
    Twilio Push Credential; validate killed-app push on physical devices.
- **2026-06-08 — session 11 — login-first native gate + per-business email-identity:**
  - **#62 login-first:** native `NativeGate` redirects `/`→`/login` in the app (web landing untouched); login
    forwards already-authed users to `/dashboard`. **#61 email-identity Phase 1:** outbound emails show the
    business name as sender (over the verified Opiflow domain) + reply-to = the business's own email
    (`src/lib/server/email-identity.ts`). **#60 gitignore** Apple `.p8`/cert secrets.
- **2026-06-08 — session 11 — 🍏 iOS LIVE on TestFlight (PRs #52–#58, Codemagic `ios-release`):**
  - First `.ipa` built, signed, uploaded → **installed + logged in on a real iPhone** via TestFlight internal group «opiflow».
  - **7 CI signing/upload fixes** (all `codemagic.yaml`): #52 inject `GOOGLE_SERVICE_INFO_PLIST` via a new `opiflow_ios` Codemagic group (iOS env had no `groups:`); #53 manual signing `app-store-connect fetch-signing-files --create` (automatic `ios_signing` only fetches → fails for a fresh app); #54 `use-profiles --project ios/App/App.xcodeproj --warn-only` + explicit `pod install` (unscoped use-profiles walked Pods.xcodeproj → App target left on Automatic signing → "App requires a provisioning profile"); #55→#56 persistent signing cert key as **base64** `CERTIFICATE_PRIVATE_KEY_B64` (raw multi-line PEM env var gets newline-flattened → "certificate-key is not valid"; also fixes "Cannot save Signing Certificates without certificate private key"); #57 `beta_groups: [opiflow]` → **internal** distribution (external submit needs test info + App Review / 4.2); #58 `ITSAppUsesNonExemptEncryption=false` (skip Export Compliance prompt).
  - **Apple/Firebase setup done (user):** ASC key → `opiflow_asc`; App ID `ai.opiflow.app` (+Push, Team `7Q7A3NFK8T`); app record (Apple ID 6778021875); APNs `.p8` → Firebase; `GoogleService-Info.plist` (base64) + `CERTIFICATE_PRIVATE_KEY_B64` in Codemagic group `opiflow_ios`.
  - **⚠️ NATIVE ARCHITECTURE FINDING (drives next pivot):** the app is a **remote-URL WebView** (`capacitor.config.json server.url = https://opiflow.vercel.app`). On-device that means: (a) opens the **marketing homepage**, not login; (b) **calls fail** — jsSIP/WebRTC `getUserMedia` mic is blocked in the iOS WKWebView for remote content; (c) **push not arriving** — verify the Firebase **APNs auth key** (user briefly uploaded the ASC `.p8` by mistake; confirm correct APNs `.p8` + Key ID + Team ID). Pivot options: native SIP SDK **Acrobits** (`saas.acrobits.net`, licensed, CallKit/PushKit) vs **Linphone** SDK (free, LGPL) + login-first native shell + iPhone-native UI. **DECISION PENDING.**
- **2026-06-08 — session 11 — Per-business email sender identity (Phase 1, `next build` green, tsc clean):**
  - New `src/lib/server/email-identity.ts`: `buildBusinessFromHeader(name, EMAIL_FROM)` → `"<Business> via Opiflow <addr>"`
    (extracts the bare address from `EMAIL_FROM`, quotes + sanitises the display name; falls back to raw `EMAIL_FROM` when no
    name). `resolveReplyTo(businessEmail, EMAIL_REPLY_TO)` prefers the business's own `businesses.email`, else the global
    `EMAIL_REPLY_TO`. No DNS/OAuth — verified Opiflow domain stays the technical sender.
  - `customer-email.ts` `SendCustomerEmailParams` gained optional `businessName` / `businessEmail`; the 3 link routes
    (`intake`/`upload`/`appointment`) now select `businesses.email` and thread name+email through. `/api/email/send-offer`
    loads `businesses.{name,email}` (best-effort, non-fatal) and applies the same `from`/`reply_to`.
  - Settings: existing **Email** field (already saved to `businesses.email`) gained a helper line explaining it is the
    reply-to address; Providers "Σύντομα" card reframed as **Σύνδεση Gmail / Outlook** (the real Phase 2).
  - **Phase 2 (NOT built):** OAuth "Connect Gmail/Outlook" (Gmail API / MS Graph) to send genuinely from the owner's mailbox —
    large effort incl. Google sensitive-scope verification. Tracked as a follow-up in §F.
- **2026-06-08 — session 10 — B3 batch (PR #50, squash → master `806ecc8`, `next build` green ±DSN, tsc clean):**
  - **#56 Email delivery for links:** new `src/lib/server/customer-email.ts` (Resend, env-gated on
    `RESEND_API_KEY`/`EMAIL_FROM`, sends ONLY to the loaded customer's own email). The 3 link routes
    (`intake-link`/`upload-link`/`appointment-link`) accept `{ channel:'email' }` in `mode:'send'`. `SendChannelSheet`
    gained an `email` backend prop; **upload + appointment review modals migrated `SendViaViberModal` → `SendChannelSheet`**
    (now Viber/WhatsApp/Email/SMS, like intake). `markIntake/UploadTokenSent` accept `'email'`.
  - **#57 Outbound-message timeline:** new `src/lib/server/record-message.ts` — every successful send (Viber/SMS/email)
    writes a `communications` row (`status:'sent'`) + a linked `viber_messages` row with the Apifon ids. The
    `apifon/status` webhook propagates `delivered/seen/failed` onto that `communications` row (**tenant-scoped by
    `business_id`** + anti-regression guard). Timeline UI renders channel + status badge (Εστάλη/Παραδόθηκε/Διαβάστηκε/Απέτυχε).
    Offer sends (Viber + `/api/email/send-offer`) also log to the timeline now.
  - **#53 Sentry (env-gated):** `@sentry/nextjs@10` (first line to support Next 16). `src/instrumentation.ts` (+`onRequestError`),
    `src/instrumentation-client.ts`, conditional `withSentryConfig` in `next.config.ts` — **wraps ONLY when `SENTRY_DSN`/
    `NEXT_PUBLIC_SENTRY_DSN` set → zero build/runtime impact without a DSN**. CSP `connect-src` adds the ingest origin when
    `NEXT_PUBLIC_SENTRY_DSN` set; `sendDefaultPii:false`. `env.ts` integration `monitoring`. (Vercel uses `--ignore-scripts`,
    so source-map upload needs `@sentry/cli` + `SENTRY_AUTH_TOKEN`; error capture works without uploaded maps.)
  - **Migration 036** (`036_email_channel_and_outbound_timeline.sql`): widens `sent_channel` CHECK on
    `customer_intake_tokens` + `customer_upload_tokens` to allow `'email'` (idempotent, NULL-safe). **APPLY MANUALLY in
    Supabase SQL editor.** App is migration-graceful (token marking is best-effort) so email + timeline work even pre-036.
  - **Adversarial review** (3 dims → verify): fixed 2 confirmed findings — per-channel `sending` state (Viber/Email buttons
    no longer both spin), and tenant-scoping the webhook `communications` update by `business_id`.
- **2026-06-08 — session 9 (cont.) — CALL-FLOW v2 + external setup DONE + provider/legal decisions:**
  - **PR #48 — Call-flow v2** (all env-gated / migration-graceful, `next build` green):
    - **Missed-call labels:** no fabricated AI brief without a recording → unanswered = «Αναπάντητη κλήση»,
      answered-no-recording = «Κλήση χωρίς ηχογράφηση». `call-brief.ts` LLM only runs when a real recording exists.
    - **HYBRID intake link** (owner decision): PBX webhook NO LONGER auto-sends the Viber intake link — it still
      auto-creates/links the customer + logs the call; the link is sent only on operator confirm via a **post-call prompt**
      «Αποστολή λινκ στοιχείων;» in `calls/page.tsx` (inbound+outbound, unsaved numbers) → create-customer-if-needed + POST intake-link.
    - **Preferred-channel sends + Viber→SMS fallback:** new `src/lib/server/apifon-sms.ts` (`sendSmsMessage`) +
      `src/lib/server/send-channel.ts` (`sendViaPreferredChannel`, honours `customer.preferred_contact_method`). All 4
      send routes (intake/upload/appointment link, offer notify) use it (were hard-coded Viber).
    - **Intake form channel picker:** customer picks Viber/WhatsApp/SMS/Email → persisted to the customer →
      future sends default to it. `PreferredContactMethod` extended (+sms/whatsapp).
    - **Deepgram diarization** (2-speaker) in `openai-call-audio.ts` (`DEEPGRAM_API_KEY`; OpenAI fallback).
    - **1h reminder cron:** new `/api/cron/intake-reminder` (`CRON_SECRET`-gated) re-sends intake if not submitted in ~1h.
    - **Migration 035** (preferred_contact_method enum + `customer_intake_tokens.reminder_sent_at/reminder_count`).
  - **✅ EXTERNAL SETUP COMPLETED (user, step-by-step):** migrations **035 + 033 + 034 APPLIED** (live `oluhmzt`);
    **`CRON_SECRET`** set on Vercel + **hourly PBX cron LIVE** (`/usr/local/bin/opiflow-intake-reminder.sh` reads
    `/etc/opiflow/cron.env`; crontab `0 * * * *`) — verified `{"ok":true,"resent":0}`; **`DEEPGRAM_API_KEY`** set on Vercel.
  - **⏳ PENDING (external):** Apifon **SMS sender «opiflow»** approval → then set `APIFON_SMS_SENDER` on Vercel (until
    then SMS fallback is a safe no-op, Viber works). Also confirm a **production Viber sender** (was "Apifon Demo", 20-msg cap).
  - **Provider/legal decisions (telephony scaling):** model = **on-demand DIDs per region** (request as customers sign up,
    NOT bulk upfront — matches the app's `phone_number_requests`/city assignment). Outbound CLI = **Option A** (show the
    Opiflow-owned DID; no per-number verification). Email to InterTelecom drafted (on-demand + mobile-69x availability +
    sub-allocation KYB/EETT + provisioning API). KYB/EETT → confirm with InterTelecom wholesale + a Greek telecom lawyer.
- **2026-06-08 — session 9 — 🟢 TELEPHONY MULTI-DID ACTIVATED (inbound + outbound) + webhook/build fixes:**
  - **HARD BLOCKER F.3 RESOLVED:** InterTelecom now **delivers the dialed DID** in the inbound INVITE
    (R-URI + To user-part, form `30XXXXXXXXXX`) — confirmed via tcpdump of a real call.
  - **Inbound DID routing LIVE:** `#include`d the provisioner files; rewrote `from-intertelecom` `_.` to read
    the DID, resolve the per-business endpoint via `[opiflow-inbound]` (default `yorgospro001`), and
    `Dial(PJSIP/${OPIFLOW_EP}&yorgospro001&groundwire001)` (ring-both during transition). Confirmed: call to the
    DID routed to `biz_<id>`; browser rang.
  - **Per-user SIP ACTIVATED:** `SIP_CRED_ENC_KEY` set on Vercel → browser registers as `biz_<id>` (per-user).
  - **Outbound caller-ID per DID (Stage 3) LIVE:** provisioner emits `set_var=OPIFLOW_DID=30…` per endpoint;
    trunk `[intertelecom]` gained `send_pai/send_rpid/trust_id_outbound=yes`; `from-webrtc` stamps
    `CALLERID(num)=${OPIFLOW_DID}` before Dial. Confirmed: callee saw the business DID (210…).
  - **Webhook fixes:** `PBX_WEBHOOK_URL` pointed at the DEAD old project `yorgos-umber.vercel.app` (404) →
    repointed to `https://www.opiflow.ai/api/webhooks/voice/pbx` (secret verified matching). PBX scripts now pass
    the **DID as `called_number`**; app webhook (PR #46) matches the DID against all forms (E.164/+30/local) so
    multi-tenant business resolution works (previously always fell back to PBX_BUSINESS_ID).
  - **Vercel build fix (PR #45):** `vercel.json` `installCommand: npm install --ignore-scripts` — Node 24 couldn't
    compile the old `sharp` pulled by `@capacitor/assets` (unused on web). Deploys green again.
  - **Provider model:** on-demand DIDs per region (NOT bulk upfront) — request numbers as customers sign up
    (matches the app's `phone_number_requests`/city-assignment model). Email drafted; **pending InterTelecom reply**
    (mobile 69x availability? per-number CLI verification? KYB/EETT obligations? provisioning API?).
  - **UX/CAM redesign batch (PRs #41-#44):** action-cockpit redesign of every screen; customer-detail v2 (manual
    uploads+gallery, multi-channel send Viber/WhatsApp/Email, hero action bar, menu cleanup); offer email→`Στάλθηκε`;
    notifications persistent mark-as-read + wider coverage. All `next build` green.
- **2026-06-07 — session 8 (cont. 4) — PRODUCT AUDIT + Team multi-user + hardening batch:**
  - **Full product audit** (8-agent workflow, adversarially criticized): ~70% built-and-works, ~20%
    half-built/inert, ~10% missing. Not yet self-serve-paid-ready; strong hand-held beta. Key gaps found:
    offer-status-stuck bug, no Sentry, env-gated providers unverified, misleading telephony UX, Team
    vaporware at the auth layer, RLS-bypassed-everywhere, billing dead buttons, native = thin webview/no PWA.
  - **PR #37 — Team multi-user (v1):** `resolveBusinessContext` (membership-first, owner_id fallback →
    owner always safe) in `auth.ts` + `businesses/me`; **migration 033** `business_invites`; `/api/team/{members,
    invites,accept}`; Settings `TeamPanel`; public `/join/[token]`. Owner/admin gate. **Needs migration 033 +
    a 2-account test.**
  - **PR #34 (B1):** offer→`sent_manually` on Viber send (was stuck at Draft) + label «Στάλθηκε»; hide dead
    billing buttons unless Stripe configured (`/api/health` now reports `billing`); telephony presence marked
    «Σύντομα» (no false routing promise); new **SystemStatusCard** (which integrations are live).
  - **PR #35 (B2):** rate-limit public token write endpoints (offer/appointment/intake) via shared limiter.
  - **PR #36 (B3):** auto high-priority follow-up task when an offer is accepted (won deal).
  - **PR #38 (B2/B3):** **migration 034** RLS defense-in-depth (enable RLS on service-only tables; anon denied;
    service_role bypasses → zero app impact); stats page real open/overdue tasks metric.
  - **🔑 Apply migrations 033 + 034** in the Supabase SQL editor (live = `oluhmzt`). Verify provider keys in Vercel.
- **2026-06-07 — session 8 (cont. 3) — ✅ ANDROID PUSH CONFIRMED ON A REAL DEVICE.** Installed the debug APK on a
  physical Android phone (had to disable Play Protect scanning to sideload the unsigned-by-Play debug APK — normal).
  The in-app **foreground banner (PushToast) displayed** and the test reported "2/2 devices" — end-to-end push works on
  real hardware, proving the BlueStacks no-show was purely the emulator (as the workflow concluded). Android push =
  **DONE & verified**. Remaining: iOS (waiting on Apple approval).
- **2026-06-07 — session 8 (cont. 2) — FCM plugin swap + Android-verify + iOS prep:**
  - **PR #30 — client push swapped to `@capacitor-firebase/messaging` v7** (+`@capacitor-firebase/app`, `firebase`):
    unified **FCM registration token on iOS AND Android** (the old `@capacitor/push-notifications` gave a raw APNs token
    on iOS that FCM v1 rejects). **Server unchanged.** Merged to master because the Capacitor app loads its JS live from
    `opiflow.vercel.app` — the live JS MUST match the new-plugin APK.
  - **`/api/push/test` + Settings button now report per-device diagnostics** (`tokenCount`, per-token FCM result) — used
    to diagnose "sent but nothing arrives".
  - **🔬 Android delivery diagnosis (workflow, adversarially CONFIRMED): NO real bug.** The test reached FCM (`sent=1`),
    but **BlueStacks emulators cannot reliably RECEIVE FCM** (modified Google Play Services don't keep the push socket
    alive). Our payload/manifest/permissions are correct → on a **real** Android 8-14 device (backgrounded) the
    notification displays. **Live Android proof deferred** to a real phone (technician at rollout) or the **iPhone via
    TestFlight**. A direct Firebase-Console test would ALSO fail on BlueStacks (same delivery path) → BlueStacks can't
    prove push, period.
  - **PR #31 — foreground in-app banner (`PushToast`)** + `notificationReceived` listener: shows an in-app banner when a
    push arrives while the app is OPEN (system tray only auto-shows when backgrounded). Pure JS/React — **no new native
    plugin** (zero iOS-build risk). Plus this changelog/state update.
  - **iOS code fully prepped (waiting on Apple):** `codemagic.yaml` `ios-release` CI-patches the AppDelegate with the 3
    APNs-forwarding methods `@capacitor-firebase/messaging` needs + registers `GoogleService-Info.plist` in the Xcode
    target (`scripts/ci/ios-appdelegate-patch.py`, `ios-register-plist.rb`); `npm ci --ignore-scripts` (avoids flaky
    `sharp` 502). **User has paid the $99 Apple Developer fee — awaiting approval (~24-48h).**
- **2026-06-07 — session 8 (cont.) — push ACTIVATED on Android + iOS audit:**
  - **Firebase project `opiflowai`** created (project number `1047198609682`). `android/app/google-services.json`
    committed (PR #22). **`FCM_SERVICE_ACCOUNT_JSON` set on Vercel** → `/api/health` shows `push:true` (PR #23 added the flag).
  - **Android app BUILT & push TESTED LIVE** on a BlueStacks emulator (no Android phone available). Build path =
    **Codemagic** (free `mac_mini_m2`); fixes needed: free plan rejects `linux_x2` (PR #25 → mac), Capacitor 7 needs
    **JDK 21** which the Mac lacked → auto-install via brew (PR #27). `codemagic.yaml` `android-debug` workflow = no-signing
    installable APK. GitHub Actions for the workflow was blocked (OAuth token lacks `workflow` scope) → used Codemagic.
  - **PR #28 — one-tap "Δοκιμή ειδοποίησης"** in Settings (`/api/push/test` + `NotificationsPanel`) — web-loaded, so it
    appears in the installed wrapper with no APK rebuild. End-to-end confirmed working on Android.
  - **Vercel free-plan build queue froze** after many rapid merges (1 concurrent build) — cleared by cancelling queued
    deploys in the dashboard (CLI has no `cancel`). Note for future: batch merges or expect queue lag.
  - **🔴 iOS audit (workflow, 6 agents, adversarially verified = CONFIRMED):** the current `@capacitor/push-notifications`
    returns a **raw APNs token on iOS**, which our **FCM HTTP v1 server rejects** (needs an FCM registration token) → iOS push
    would silently fail (and the row could be pruned). **Android is unaffected** (it already gets a real FCM token). **Fix =
    Option A:** swap client to **`@capacitor-firebase/messaging` v7** (+ `@capacitor-firebase/app`, `firebase`) → unified FCM
    token on both platforms; **server stays as-is** (the `apns` relay block already exists). Native gotchas: commit `ios/`
    (or CI-patch) so the AppDelegate has the **3 APNs-forwarding methods** the plugin needs (NOT `FirebaseApp.configure()` —
    `@capacitor-firebase/app` auto-inits); register **GoogleService-Info.plist in the Xcode target** (Copy Bundle Resources),
    not just on disk; upload an **APNs Auth Key (.p8) to Firebase**. The plugin swap also changes Android's JS API → must
    re-test the Android APK before merging. `codemagic.yaml` `ios-release` workflow verified ~correct (one real bug: plist
    must be in the bundle). Full plan in section G.
- **2026-06-07 — session 8 (native push notifications → app-store path):**
  - **Native push (Android-first, iOS-ready) — built, env-gated, INERT until FCM keys.** Same
    safe pattern as per-user SIP: wired end-to-end but a silent no-op until configured.
    - migration **032** `device_push_tokens` (one row/device token, RLS own-row, service-role writes);
    - `src/lib/server/push.ts` — **FCM HTTP v1** sender (service-account JWT→OAuth2, no SDK; legacy
      FCM API is dead). `isPushEnabled()` gate, `sendPushToUser` / `sendPushToBusinessOwner`, dead-token
      pruning. Config via `FCM_SERVICE_ACCOUNT_JSON` **or** `FCM_PROJECT_ID`/`FCM_CLIENT_EMAIL`/`FCM_PRIVATE_KEY`;
    - `POST/DELETE /api/push/register` (authed, defensive — degrades if 032 not applied);
    - `src/lib/native/push.ts` (`registerNativePush`) mounted in `AppShell` after login — native-only,
      dynamic-imported so it never enters the web bundle; requests perm → registers → POSTs token →
      tap deep-links via `data.url`;
    - **triggers:** customer offer accept/reject (`/api/offer-response`) + appointment response
      (`/api/appointment-response`) now `sendPushToBusinessOwner(...)` (best-effort, awaited, inert);
    - `@capacitor/push-notifications@^7` added; `capacitor.config.json` push presentation opts;
    - **`codemagic.yaml`** — cloud-Mac CI (the dev box has no Mac): `android-release` (.aab) +
      `ios-release` (.ipa→TestFlight, runs `cap add ios` on the Mac); `docs/NATIVE_WRAPPER.md` Push section.
  - **Why:** native push = the "native value" that lets the **iOS build pass Apple guideline 4.2**
    (a pure web-view wrapper risks public-release rejection). `next build` green.
  - Also fixed stale `deskop.ai` refs in `docs/NATIVE_WRAPPER.md` → `opiflow.vercel.app` / `ai.opiflow.app`.
- **2026-06-07 — session 7 (Opiflow rebrand + telephony scale):**
  - **PR #12 (6327cce) Rebrand deskop → Opiflow** — names everywhere; client Viber
    signature "μέσω Opiflow Assistant"; emerald theme via a single `@theme` remap of
    `indigo-*`→`#00C499` (covers 431 usages / 71 files); new flow-ring logo
    (`public/icon.svg` + regenerated PNGs, `src/components/brand/OpiflowLogo.tsx`);
    domain → `opiflow.vercel.app`; Android pkg `ai.deskop.app`→`ai.opiflow.app`. **LIVE.**
  - **PR #13 (56c822f) Per-user SIP provisioning + A/B onboarding + presence** —
    migration **031** (`browser_sip_endpoints.sip_password_enc`, `businesses.telephony_mode`,
    `business_user_presence`); `src/lib/server/sip-credentials.ts` (AES-256-GCM,
    `SIP_CRED_ENC_KEY` = enable switch); `browser-token` per-user path with **env
    fallback**; `/api/phone/presence` + `/api/phone/telephony`; Settings → `TelephonyPanel`.
    Backward-compatible / **inert until activated**.
  - **PR #14 (33e1bad) SIP sync worker (ARA approach)** — `scripts/sync-sip-to-asterisk.mjs`.
    ⚠️ **Superseded** by the static-config provisioner (the PBX has no DB).
  - **PR #15-16 — canonical docs + project-ref fix:** `PROJECT_STATE.md` + `AGENTS.md` (auto-loaded);
    corrected the live Supabase ref to `oluhmztfimmgmbxoioea` (the hgboy mix-up).
  - **PR #17 — telephony pre-flip fixes (adversarial-reviewed):** app `browser-token` no longer mints
    (provisioner = SOLE password authority → kills the dual-writer race / silent 401s); provisioner
    self-creates endpoint rows (direct INSERT — `ensure_browser_sip_endpoint` RPC has a 42702 bug) +
    writes conf 0640 root:asterisk.
  - **PR #18 — dead-code cleanup (3-agent audit):** removed 5 unused components + the superseded ARA
    telephony files (`sync-sip-to-asterisk.mjs`, `ara_pjsip_realtime.sql`, `ASTERISK_REALTIME_PROVISIONING.md`)
    + junk; **REVERTED the orphaned AI scaffolding** in `customers/[id]/page.tsx` (long-standing loose end — gone).
  - **PR #19 — docs archive:** moved the pre-rebrand `docs/00-07` spec bundle + MVP-era checklists to
    `docs/archive/`; deleted obsolete mojibake doc. `docs/` now = DEPLOY, PRODUCTION_ROADMAP, SETUP_AND_COSTS, NATIVE_WRAPPER, ci-workflow.
  - **PR #20 — customer-memory AI wired:** `src/components/customers/CustomerSummaryFromCalls.tsx` — the
    previously-unwired `/api/ai/customer-memory` endpoint is now a "✨ Σύνοψη από κλήσεις (AI)" button on the
    customer card: consolidates recent call briefs + tasks + offers → proposed status summary + **next best
    action** (review-first → Αποδοχή PATCHes the memory fields that already render). Per-call brief tap-to-view already worked.
  - **PBX deep-dive (live, via SSH):** provisioner deployed + verified at `/opt/opiflow/provision-asterisk.py`;
    per-user endpoint clone of `yorgospro001` + outbound ready, INERT (not yet `#include`d). **🔴 InterTelecom does
    NOT deliver the dialed DID** (tcpdump of a real inbound: every call → `INVITE sip:IT658318@...`, the DID is absent) →
    per-user INBOUND routing is BLOCKED on the provider (needs DID/DDI delivery or per-DID accounts).
- **2026-06-03 … 06-05 — sessions 1-6 (pre-rebrand, as "deskop"):** launch-readiness
  (mobile shell, security lockdown, dead-code removal, public pages, server onboarding
  gating, shared auth helper, Viber-modal dedup); marketing site; Google/Apple OAuth;
  CRM import/export; .ics + opportunity value + maps + notifications; demo removal;
  Capacitor wrapper + setup/cost docs; production roadmap (RLS, billing, Sentry,
  vitest, design system, Upstash rate-limit); in-app call recording → AI brief;
  CRM action wizards + offer numbering/value/status automation; inline accept/reject
  for appointment time-change. (PRs #1-#11, all merged.)

## E. Current state (where we are NOW)
- **App:** rebrand LIVE and healthy. Per-user-SIP code shipped but **INERT** — `SIP_CRED_ENC_KEY`
  not yet set on Vercel.
- **Supabase:** live = **`oluhmztfimmgmbxoioea`**; **migration 031 IS applied there** (verified:
  `sip_password_enc` exists). Data: **1 business, 1 active number, 1 provisioned `browser_sip_endpoints` row**
  (the provisioner self-creates rows + mints passwords). (`hgboy` = old, to be deleted; `.env.local` updated to oluhmzt.)
- **PBX:** SSH access (key `~/.ssh/yorgos_pbx_vps_600`). `/opt/opiflow/provision-asterisk.py` +
  `/etc/opiflow/sip.env` now correctly point at **oluhmzt** with a working service key
  (verified: `--dry-run` connects; 0 users to provision yet). **Not yet wired into live Asterisk.**
  Backups `/etc/asterisk/{pjsip,extensions}.conf.opiflow-bak.20260607114549`.
- **Vercel CLI:** logged in + linked `sane127/opiflow`.
- **App features:** customer-memory AI ("✨ Σύνοψη από κλήσεις") wired & live on the customer card; repo
  audited + cleaned (no dead code / no orphaned scaffolding); working tree clean.
- **Native apps:** 🟢 **Android DONE & CONFIRMED ON A REAL PHONE** (push delivered + foreground banner shown); APK builds on Codemagic; push **ACTIVE**
  (Firebase `opiflowai`, `FCM_SERVICE_ACCOUNT_JSON` live, migration 032 applied, one-tap test button works). For Google
  Play: build the signed `.aab` (`android-release` workflow) + Play Console ($25). 🟡 **iOS NOT started** — needs Apple
  Developer ($99/yr) + the **plugin swap to `@capacitor-firebase/messaging`** (see G) before push works on iPhone; build via
  Codemagic `ios-release` → TestFlight. `ios/` not yet generated. Store-blockers already covered: in-app account deletion, privacy + terms.
- **Open infra (user's side):** **apply migrations 033 + 034** (SQL editor); verify provider keys in Vercel
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `APIFON_*`, `RESEND_*` — the SystemStatusCard now shows which are live);
  test Team with a 2nd account; delete old Supabase `hgboy` + Vercel `yorgos`; email InterTelecom about DID
  delivery; local folder rename `E:\yorgos`→`E:\opiflow` (memory pre-copied).
- **Product roadmap REMAINING (from the audit, for a focused follow-up):** ✅ **#53 Sentry DONE** (PR #50, env-gated
  — set `SENTRY_DSN` to activate); ✅ **#56 email delivery DONE** (PR #50); ✅ **#57 delivery status in timeline DONE**
  (PR #50); **#58γ** make the `pbx-recording` webhook multi-tenant (low priority — single business + inbound blocked);
  **#59 monetization** (DEFERRED by user — payments later); offline/PWA for the native wrapper (field signal).
- **App-store path (user's side):** apply migration 032 (SQL editor); Firebase project + service-account
  JSON → set `FCM_*` on Vercel; Google Play Console ($25) + build signed `.aab`; Apple Developer ($99/yr)
  + cloud-Mac for the iOS/TestFlight build + APNs key in Firebase. See `docs/NATIVE_WRAPPER.md`.

## F. Open problems / blockers
1. ✅ **RESOLVED — project confusion.** Live = `oluhmzt`; 031 is applied there; the PBX is
   repointed with a working service key. (The earlier "031 missing / 0 rows" was from querying
   the dead `hgboy`, because `.env.local` was stale.)
2. ✅ DONE: provisioner self-creates endpoint rows (direct INSERT — the `ensure_browser_sip_endpoint`
   RPC has a 42702 ambiguous-`sip_username` bug; app no longer mints, provisioner is sole authority;
   conf written 0640 root:asterisk). Endpoint clone of yorgospro001 + outbound = ready & reviewed.
3. ✅ **RESOLVED 2026-06-08 (session 9) — DID delivery enabled; full multi-DID (inbound DID routing + per-user SIP + outbound caller-ID per DID) is LIVE & tested.** Historical context below. tcpdump of a real inbound
   call proved **InterTelecom sends EVERY call to `INVITE sip:IT658318@...` / `To: IT658318`** — the
   dialed DID (`+302104400811`) is **absent from the entire SIP exchange** (0 occurrences; no
   Diversion / P-Called-Party-ID). So Asterisk cannot tell which number was dialed → DID→user routing
   is impossible until InterTelecom either (A) delivers the dialed number in the INVITE R-URI/To (or a
   Diversion/P-Called header) — i.e. enable **DID/DDI delivery** — and provisions the 30-50 DIDs, OR
   (B) gives a **separate SIP account per DID**. This is a provider request. Capture method (tcpdump
   UDP 5060 host 146.120.226.3) is proven → once they enable DID delivery, re-capture + finalize the
   dialplan in minutes. Per-user ENDPOINTS + OUTBOUND already work without this.
3. **Secret handling boundary:** the assistant **cannot read `.env.local` or move raw
   secrets** (safety rule + auto-mode classifier blocks `vercel env pull`, prod-secret
   reads). The user ships each secret via:
   `grep VAR= .env.local | tr -d '\r' | ssh -i ~/.ssh/yorgos_pbx_vps_600 root@46.224.138.115 "cat>>/etc/opiflow/<file>"`.
4. **PBX has no DB** → we use **static-config generation + reload** (not Asterisk Realtime).
   The committed `sync-sip-to-asterisk.mjs` and the ARA runbook are now out of date.
5. **Email Phase 2 (follow-up, not built):** "Connect Gmail/Outlook" via OAuth (Gmail API /
   Microsoft Graph) so outbound email is sent genuinely from the owner's mailbox (not just
   reply-to + display-name over the Opiflow domain, which is what Phase 1 ships). Large effort:
   OAuth consent + token storage/refresh per business, send-on-behalf, and **Google sensitive-scope
   verification** (security assessment) before `gmail.send` can go to non-test users. Only worth it
   if customers report the "via Opiflow" sender as a trust problem — email is the fallback channel.

## G. Plan / next steps (telephony activation)
1. ✅ Migration 031 applied (on the live project `oluhmzt`).
2. ✅ Provisioner self-creates endpoint rows; app no longer mints (provisioner = SOLE password
   authority); conf written 0640 root:asterisk. Per-user endpoint clone of `yorgospro001` + outbound = ready.
3. ⏸ **BLOCKED on InterTelecom (see F.3):** per-user INBOUND needs the provider to deliver the
   dialed DID in the SIP INVITE (or per-DID SIP accounts). Until then the live wiring (the `#include`s +
   the `from-intertelecom` `Dial→${OPIFLOW_EP}` tweak + flipping `SIP_CRED_ENC_KEY` on Vercel) is ON HOLD —
   applying it now would route every inbound to the shared endpoint anyway.
4. When the provider enables DID delivery: re-capture a test call (`tcpdump -i any 'udp port 5060 and host
   146.120.226.3'`), finalise the dialplan to the delivered DID form, apply the additive includes + the
   `Dial→${OPIFLOW_EP}` tweak (default `yorgospro001`), reload, set `SIP_CRED_ENC_KEY` on Vercel (same value
   as the box `/etc/opiflow/sip.env`), test, then `cron` the provisioner. Rollback: unset the Vercel key
   (app → shared `yorgospro001`) + remove the includes + reload.

## H. Cleanup pending (org)
- **Delete OLD projects** (keep only the new): old Supabase project + Vercel `yorgos`
  (directsourcing.gr) — **confirm each is unused before deleting**; keep Supabase `oluhmzt`
  + Vercel `opiflow`. After any key/password rotation, **re-update `.env.local`** AND
  re-ship the new service key to the PBX + update Vercel env.
- ✅ Deleted the superseded ARA files (`scripts/sync-sip-to-asterisk.mjs`,
  `supabase/asterisk/ara_pjsip_realtime.sql`, `docs/ASTERISK_REALTIME_PROVISIONING.md`) + 5
  never-imported components + stray `modulo` + stale `supabase/migrations_combined.sql`. A fresh
  static-provisioner runbook will be written once InterTelecom unblocks inbound.
- Decide the orphaned AI-suggestion scaffolding in `src/app/(app)/customers/[id]/page.tsx`
  (declared/set, never used) → **recommend discard** (`git checkout`).

## I. Renames pending (org)
- **GitHub repo** `gsane3/yorgos` → `gsane3/opiflow` (user: repo Settings → Rename;
  then assistant runs `git remote set-url origin …/opiflow.git` — GitHub auto-redirects).
- **Local folder** `E:\yorgos` → `E:\opiflow` (do it with NO active Claude session;
  no code hardcodes the path; the assistant migrates the `~/.claude` memory dir after).
- Already done: Vercel project = `opiflow`, app domain = `opiflow.vercel.app`, Capacitor
  `ai.opiflow.app`, package name `opiflow`.

## J. Secrets / access map
- **Assistant CAN:** git + `gh` (authenticated); SSH to PBX (key present); Vercel CLI
  (logged in, linked).
- **Assistant CANNOT:** read `.env.local`; enter/move raw secrets (service key, DB
  password, enc key). The user must place those (one-line `grep|ssh` ships, or dashboard).
- Secret locations: `.env.local` (local), Vercel env (prod app), `/etc/opiflow/sip.env`
  (+ planned `db.env`) on the PBX.

## K. Update protocol
Before every `/compact` (and after notable changes): bump **Last updated**, append to
**D. Changelog**, and refresh **E/F/G** (state / blockers / plan). Keep **B** (infra IDs)
exact — it is the canonical reference.
