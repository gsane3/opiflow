# What to set up & pay to run deskop.ai for 10–20 people

This is a practical checklist of the accounts and services the product depends on, what each one is for, and a realistic monthly cost for a 10–20 user pilot in Greece. Prices are approximate (2026) and pay‑as‑you‑go unless noted.

---

## 1. Core platform (always needed)

| Service | What it does here | Plan for 10–20 users | Cost |
|---|---|---|---|
| **Supabase** | Database, Auth (email + Google/Apple), file storage (customer photos) | Pro (Free works to start, Pro for backups + no pausing) | **$25/mo** (Free $0 to start) |
| **Vercel** (or any Node host) | Hosts the Next.js app + API routes + the marketing site | Pro (commercial use) | **$20/mo** (Hobby $0 for testing) |
| **Domain** | e.g. `deskop.ai` + `app.deskop.ai` | — | **~€12/yr** |

> You can self‑host instead of Vercel (a $5–20/mo VPS + Docker) to cut cost, at the price of more ops work.

## 2. AI (per‑call brief + assistant)

| Service | What it does | Env var | Cost for this volume |
|---|---|---|---|
| **Anthropic (Claude)** | Per‑call AI brief, AI assistant (`/cmd`), customer‑memory suggestions. Uses cheap Haiku model. | `ANTHROPIC_API_KEY` | **~$5–30/mo** |
| **OpenAI** | Call‑recording transcription + richer brief (only if you record calls) | `OPENAI_API_KEY` | **~$0.006/min** → ~$20–80/mo depending on call minutes |

Both are optional/independent: with no key the app still works (you fill briefs manually). Start with Anthropic only; add OpenAI when you wire call recording.

## 3. Telephony — the make/receive‑calls layer (the big decision)

The app uses a **browser SIP phone (jsSIP)** + **PBX webhooks**. You need a SIP backend and Greek phone numbers (DID). Two routes:

**A. SIP trunk + your own Asterisk/FreePBX** (cheapest at scale, more setup)
- A small VPS for Asterisk: **$10–40/mo**
- Greek DID numbers from a SIP provider (e.g. Modulus, Voipfone, didww): **~€1–3 per number/mo**. For 10–20 pro numbers ≈ **€20–60/mo**
- Per‑minute: **~€0.005–0.02/min**
- Set: `PHONE_SIP_WSS_URL`, `PHONE_SIP_USERNAME`, `PHONE_SIP_PASSWORD`, `PHONE_SIP_REALM`, `PBX_BUSINESS_ID`, and **`PBX_WEBHOOK_SECRET`** (required in production), point the Asterisk dialplan at `/api/webhooks/voice/pbx` and `/api/webhooks/voice/pbx-recording`.

**B. CPaaS (Telnyx / Twilio)** (faster to launch, higher per‑minute)
- Numbers ~$1/number/mo, minutes ~$0.01/min, programmable SIP/WebRTC. There's already a Telnyx webhook stub to build on.

**Rough telephony total for a pilot: €50–150/mo** depending on call volume and route.

> ⚠️ Security: set `PBX_WEBHOOK_SECRET` / `APIFON_WEBHOOK_SECRET` in production. The webhooks now **fail closed** in production if the secret is unset (override only with `ALLOW_INSECURE_WEBHOOKS=1`).

## 4. Viber link delivery (Apifon)

| Service | What it does | Env vars | Cost |
|---|---|---|---|
| **Apifon** (Greek) | Sends the Viber message with the link (intake / offer / appointment / photos) | `APIFON_CLIENT_ID`, `APIFON_API_KEY`, sender id, `APIFON_WEBHOOK_SECRET` | **per message ~€0.02–0.05** + Viber **sender registration** (one‑time, sometimes a setup/monthly fee). Budget **€20–60/mo** for pilot volume. |

If Apifon isn't configured, the app falls back gracefully to "copy the message and send manually."

## 5. Email (offers by email)

| Service | What it does | Env vars | Cost |
|---|---|---|---|
| **Resend** | Sends offer emails from your verified domain | `RESEND_API_KEY`, `EMAIL_FROM`, optional `EMAIL_REPLY_TO` | **Free** up to 3,000/mo, then **$20/mo** |

## 6. Login providers & app stores

| Service | What it does | Cost |
|---|---|---|
| **Google Cloud OAuth** | "Continue with Google" | **Free** |
| **Apple Developer Program** | "Continue with Apple" **and** required for any iOS app | **$99/yr** |
| **Google Play Console** | Publish the Android app | **$25 one‑time** |

OAuth setup: create the providers in Supabase → Authentication → Providers (Google, Apple), and add `https://<your-domain>/auth/callback` to the allowed Redirect URLs. The login/register buttons are already wired.

---

## Bottom line for a 10–20 user pilot

**One‑time:** Google Play $25 + Apple $99/yr + domain ~€12/yr + Viber sender registration (varies).

**Monthly (typical):**
- Fixed platform: Supabase $25 + Vercel $20 ≈ **$45**
- AI: **$10–80** (depends on call/recording volume)
- Telephony (numbers + minutes + PBX host): **€50–150**
- Viber: **€20–60**
- Email: **$0–20**

➡️ **Realistic range: ~€150–350 / month** for the whole pilot, dominated by telephony + Viber usage. You can start much lower (Supabase Free + Vercel Hobby + Anthropic only + manual Viber fallback) to validate before turning on paid telephony.

## Env var checklist (set in Vercel / your host)

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
# AI
ANTHROPIC_API_KEY=
OPENAI_API_KEY=                 # optional (call recording)
# Telephony (SIP browser phone + PBX webhooks)
PHONE_SIP_WSS_URL=
PHONE_SIP_USERNAME=
PHONE_SIP_PASSWORD=
PHONE_SIP_REALM=
PBX_BUSINESS_ID=
PBX_WEBHOOK_SECRET=            # REQUIRED in production
# Viber (Apifon)
APIFON_CLIENT_ID=
APIFON_API_KEY=
APIFON_WEBHOOK_SECRET=        # REQUIRED in production
# Email (Resend)
RESEND_API_KEY=
EMAIL_FROM=
EMAIL_REPLY_TO=               # optional
# Admin (number assignment console)
ADMIN_USER_ID=
```
