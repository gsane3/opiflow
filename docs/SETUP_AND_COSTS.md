# Opiflow — Setup, accounts & running costs (production)

How to take Opiflow **live and rock-solid** ("σφαίρα"): which accounts to open, which plan
to pick, in what order, and what it costs. Prices are 2026, USD→EUR ≈ 0.92.

> Unit economics (cost **per customer/month**, pricing, margins, 2-year planning inputs)
> live in **[`../OPIFLOW_BUSINESS_BRIEF.md`](../OPIFLOW_BUSINESS_BRIEF.md)**. This file is
> the operational "how to switch it on" checklist.

---

## 0. Architecture in one paragraph (what actually costs money)

A customer (tenant) = one Greek service business with **1 dedicated Greek number**.
Inbound: PSTN caller → **InterTelecom** DID → **Asterisk PBX** (one shared Hetzner VPS) →
**Twilio** SIP Domain → `Dial Client` rings the **app** (Twilio Voice SDK), waking a killed
app via VoIP push. Outbound is the mirror. Recording: **inbound on Asterisk** (free of Twilio
cost), **outbound on Twilio** (deleted after use). The WAV is transcribed by **Deepgram**
(primary) or **OpenAI** (fallback), then an **OpenAI gpt-4o** brief is written. The text AI
assistant (`/cmd`, reply-drafts) is **Anthropic Claude Haiku**. Customer messages go through
**Apifon** (Viber + SMS); offer emails through **Resend**. Data/auth/storage = **Supabase**;
hosting = **Vercel**; the app's own subscription billing = **Stripe**.

---

## 1. Production activation checklist (do in this order)

### Step 1 — Core platform (mandatory, premium)
1. **Supabase → upgrade to Pro ($25/mo).** 🔴 Free tier *pauses* the project after ~1 week
   idle (kills the inbound-call webhook) and has **no backups** — unacceptable for a CRM.
   Pro = no-pause + daily backups (7-day PITR). Apply all `supabase/migrations/*.sql`
   **manually in the SQL editor** on the live project `oluhmztfimmgmbxoioea` (not `db push`).
   Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. **Vercel → Pro ($20/mo).** 🔴 Hobby is **non-commercial** (ToS) + tighter limits. Connect
   `sane127/opiflow`, set every env var below, set `NEXT_PUBLIC_APP_URL` to the live domain.
3. **Domain** (`.gr` ~€12/yr recommended; `.ai` got expensive). Point `app.` at Vercel.

### Step 2 — Telephony (mandatory, mixed)
4. **InterTelecom**: buy 1 geographic DID per customer (**€15/yr each**, manual — email IT to
   place it on trunk `IT658318`). Confirm the **per-minute outbound rate** + that **inbound is
   free** (see brief — this is the #1 cost unknown).
5. **Hetzner VPS** for Asterisk (already provisioned, `root@46.224.138.115`, ~€4.5/mo). Add
   €1/mo snapshots. Set `PBX_WEBHOOK_SECRET` (required) + `PBX_BUSINESS_ID`; point the dialplan
   at `/api/webhooks/voice/pbx`, `/pbx-recording`, `/pbx-voicemail`.
6. **Twilio**: **upgrade out of trial** (load credit — no monthly fee). Create an API Key,
   a TwiML App, a SIP Domain, and **two Push Credentials** (APNs VoIP `.p8` for iOS, FCM for
   Android). Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY`,
   `TWILIO_API_SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_OUTBOUND_SIP_DOMAIN`,
   `TWILIO_PUSH_CREDENTIAL_SID_IOS`, `TWILIO_PUSH_CREDENTIAL_SID_ANDROID`, `TWILIO_REGION=us1`,
   and the `TWILIO_*_WEBHOOK_URL` trio. (Production not Sandbox APNs; all in region us1.)

### Step 3 — AI pipeline (pay-as-you-go, no subscription — just fund the accounts)
7. **Deepgram** API key (`DEEPGRAM_API_KEY`) — primary transcription ($200 free credit).
8. **OpenAI** API key (`OPENAI_API_KEY`) — fallback STT + the gpt-4o brief
   (`OPENAI_BRIEF_MODEL` optional, default `gpt-4o`; `OPENAI_TRANSCRIPTION_MODEL` optional).
9. **Anthropic** API key (`ANTHROPIC_API_KEY`) — the `/cmd` assistant + reply-drafts.
   > Each is optional & independent: with no key that feature degrades gracefully (manual brief).

### Step 4 — Messaging & email
10. **Apifon** 🔴 — register a **Viber sender ID** + sign the plan (**likely ~€150/mo minimum**,
    confirm!). Set `APIFON_CLIENT_ID`, `APIFON_API_KEY`, `APIFON_SENDER_ID`
    (or `APIFON_VIBER_SENDER_ID`/`APIFON_SMS_SENDER`), `APIFON_WEBHOOK_SECRET` (required).
    Without it the app falls back to "copy & send manually".
11. **Resend** — verify your domain, set `RESEND_API_KEY`, `EMAIL_FROM`. Free ≤3,000/mo.

### Step 5 — Apps & push
12. **Apple Developer Program ($99/yr)** — iOS build + APNs. **Google Play ($25 one-time)** —
    Android. Set `APPLE_APP_ID`, `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS`
    (deep links). **FCM** for Android push: `FCM_SERVICE_ACCOUNT_JSON` (or the 3 split vars).

### Step 6 — Billing, ops & hardening
13. **Stripe** (your subscription revenue): `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`,
    `STRIPE_WEBHOOK_SECRET`.
14. **Crons**: `CRON_SECRET` (scheduled messages, weekly summary, recordings-reconcile).
15. **Admin**: `ADMIN_USER_ID` (number-assignment console).
16. **Recommended for "σφαίρα":** **Sentry** (`SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`) for
    error monitoring; **Upstash Redis** (`UPSTASH_REDIS_REST_URL` + `_TOKEN`) for shared
    rate-limiting. Both have free tiers — fine to start, upgrade at scale.
17. **NEVER set `ALLOW_INSECURE_WEBHOOKS=1` in production** — the voice/Apifon webhooks
    fail-closed without their secret on purpose.

---

## 2. Premium vs pay-as-you-go vs free

| Tier | Services | Why |
|---|---|---|
| **Must be premium** | Supabase Pro · Vercel Pro · Apple Developer · Hetzner VPS · Apifon plan | Free tier breaks production (pausing, no-backup, non-commercial, no Viber sender) |
| **Pay-as-you-go** (fund, no monthly fee) | Twilio · InterTelecom (€15/yr/number) · OpenAI · Deepgram · Anthropic · Stripe (% of revenue) | Scale with usage; already inside the per-customer numbers |
| **Free to start** | Resend (≤3k/mo) · Sentry (≤5k err) · Upstash (≤10k/day) · FCM/APNs | Upgrade only when you outgrow them |

---

## 3. Fixed monthly platform cost ≈ **€55/mo** (before Apifon)

Supabase Pro €23 + Vercel Pro €18.4 + Hetzner €4.5 + Apple €7.6/mo + domain €1 + Resend €0.
**+ Apifon** (the big swing — if it has a ~€150/mo minimum it becomes the largest fixed line).
Google Play is a one-time $25. Everything else scales with usage — see the brief.

---

## 4. Full env-var checklist (set in Vercel)

```
# ── Core ──
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=

# ── AI: transcription + call brief ──
DEEPGRAM_API_KEY=               # primary STT
OPENAI_API_KEY=                 # fallback STT + gpt-4o brief
OPENAI_BRIEF_MODEL=             # optional (default gpt-4o)
OPENAI_TRANSCRIPTION_MODEL=     # optional
# ── AI: text assistant ──
ANTHROPIC_API_KEY=              # /cmd, reply-drafts (Claude Haiku)

# ── Twilio Voice (in-app calling) ──
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY=
TWILIO_API_SECRET=
TWILIO_TWIML_APP_SID=
TWILIO_OUTBOUND_SIP_DOMAIN=
TWILIO_PUSH_CREDENTIAL_SID_IOS=
TWILIO_PUSH_CREDENTIAL_SID_ANDROID=
TWILIO_REGION=us1
TWILIO_INBOUND_WEBHOOK_URL=
TWILIO_OUTBOUND_WEBHOOK_URL=
TWILIO_RECORDING_WEBHOOK_URL=
TWILIO_DIAL_TIME_LIMIT_SECONDS=   # optional
OUTBOUND_ALLOWED_DEST_REGEX=      # optional (outbound allowlist)
OUTBOUND_DAILY_CALL_CAP=          # optional (abuse cap)

# ── Asterisk PBX webhooks (REQUIRED in prod) ──
PBX_WEBHOOK_SECRET=
PBX_BUSINESS_ID=

# ── Optional: legacy browser SIP phone ──
PHONE_SIP_WSS_URL=
PHONE_SIP_REALM=
PHONE_SIP_USERNAME=
PHONE_SIP_PASSWORD=
SIP_CRED_ENC_KEY=

# ── Messaging (Apifon) ──
APIFON_CLIENT_ID=
APIFON_API_KEY=
APIFON_SENDER_ID=               # or APIFON_VIBER_SENDER_ID / APIFON_SMS_SENDER
APIFON_BASE_URL=                # optional
APIFON_WEBHOOK_SECRET=          # REQUIRED in prod

# ── Email (Resend) ──
RESEND_API_KEY=
EMAIL_FROM=
EMAIL_REPLY_TO=                 # optional

# ── Android push (FCM) ──
FCM_SERVICE_ACCOUNT_JSON=       # or FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY

# ── Billing (Stripe) ──
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=

# ── Ops ──
CRON_SECRET=
ADMIN_USER_ID=
SENTRY_DSN=                     # recommended
NEXT_PUBLIC_SENTRY_DSN=         # recommended
UPSTASH_REDIS_REST_URL=         # recommended at scale
UPSTASH_REDIS_REST_TOKEN=
# Deep links
APPLE_APP_ID=
ANDROID_PACKAGE_NAME=
ANDROID_SHA256_CERT_FINGERPRINTS=
# NEVER set ALLOW_INSECURE_WEBHOOKS in production
```
