# Opiflow — Project State & Log (canonical)

> **This is the always-current source of truth for the Opiflow project.**
> Read it first at the start of every session. **Update it before every `/compact`**
> and after any significant change (infra IDs, changelog, current state, blockers,
> plan, loose ends). It lives in the repo, so it survives folder/repo renames.
> A private cross-session copy of the gist also lives at
> `~/.claude/projects/<proj>/memory/project_yorgos_ai.md`.
>
> **Last updated:** 2026-06-08 — session 10 (**B3 batch: PR #50** — #56 email delivery for intake/upload/appointment links, #57 outbound-message timeline with Viber/SMS/email delivery status, #53 Sentry env-gated). Earlier session 9: **TELEPHONY MULTI-DID LIVE** + **CALL-FLOW v2** (missed-call labels, hybrid intake-link prompt, preferred-channel sends + Viber→SMS, Deepgram diarization, 1h reminder cron); UX/CAM redesign + customer-detail v2 + Vercel `sharp` fix. **Blocker F.3 RESOLVED.** Migrations **033/034/035 APPLIED**; **036 PENDING (apply in Supabase SQL editor)**. `SIP_CRED_ENC_KEY`+`CRON_SECRET`+`DEEPGRAM_API_KEY` set on Vercel; **hourly PBX cron live**. **Pending (external): Apifon SMS sender «opiflow» approval → `APIFON_SMS_SENDER`; InterTelecom on-demand DIDs reply; Apifon WhatsApp/SMS automation reply. Optional: set `SENTRY_DSN` to activate Sentry.**

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
