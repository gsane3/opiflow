# Opiflow — Technical Overview (external / shareable)

> **Audience:** investors, advisors, prospective partners and contractors.
> **Redacted by design:** this version omits internal infrastructure identifiers
> (server IPs, project/account IDs, repo names, SSH paths, carrier/trunk numbers,
> store/team IDs, file paths). The internal engineering doc (`OPIFLOW_OVERVIEW_GR.md`)
> carries those. Nothing here is a secret; it is a faithful, high-level architecture
> summary grounded in the real codebase.
>
> **Last updated:** 2026-06-26

---

## 1. What Opiflow is

Opiflow is a **mobile-first "business phone + CRM"** for Greek tradespeople and small
service businesses (plumbers, electricians, technicians). Each business gets a **real
Greek landline number that rings inside the app**. Every call is **recorded** (with the
legally required spoken disclosure), **transcribed**, and turned into an **AI summary**
that lands automatically on the customer's card. Around that sits a lean CRM: customers,
"Jobs" (projects), quotes, appointments, messaging (Viber/SMS/email), and a **public
customer portal** where the customer views their quote and responds — no login. Billing
is a **single Stripe subscription** (€37.14/month incl. VAT). The product is **Greek-only**.

## 2. Architecture at a glance

Three clients on **one** shared backend:

```
   Web app (browser/PWA)   Native app (iOS+Android)   Public portal (no login)
   Next.js + React         Expo / React Native        token-in-URL
            \                      |                        /
             \____________________ | _______________________/
                                   v
            Backend = Next.js API routes on Vercel  (~100 endpoints)
            (all business logic + security live here)
                       |                         |
                       v                         v
                 Supabase                  Telephony (separate box)
                 Postgres + Auth           Greek carrier → Asterisk PBX → Twilio → app
                 + Storage
                       \________ + external services (Stripe, Deepgram, OpenAI,
                                  Anthropic, SMS/Viber, email, push, monitoring) ___/
```

The **Next.js backend** is the center of gravity: clients are thin, all logic/security
and third-party calls run server-side. The **telephony** is a separate, more traditional
piece of infrastructure (a self-managed Asterisk PBX) and is the most specialised part.

## 3. Key components

- **Web app** — Next.js (App Router) + React + Tailwind, hosted on Vercel; mostly
  client-rendered, mobile-style navigation.
- **Native app** — Expo / React Native, **real native screens** (not a WebView) sharing
  the exact same backend as web. iOS + Android.
- **Backend API** — ~100 **thin** Next.js route handlers (auth → parse → service → error
  map). Business logic and DB access live in a **modular monolith** (`server/modules/<domain>`
  with service + repo layers) over a small core (central errors, a structural
  tenant-isolation DB wrapper, auth adapter). *(Refactored to this shape and live since
  June 2026; behaviour was preserved byte-for-byte.)*
- **Database** — Supabase (PostgreSQL) + Auth (email/password + Google/Apple) + Storage
  (private bucket for customer photos/videos via signed URLs).
- **Telephony** — a Greek SIP carrier delivers the landline numbers to a self-managed
  **Asterisk PBX**, which routes/records/plays the disclosure and bridges to **Twilio
  Programmable Voice** so the **native app rings even when closed** (VoIP push / CallKit).
  The web app uses WebRTC (jsSIP) directly.
- **AI pipeline** — recording → **Deepgram** (Greek transcription with speaker
  diarization) → **OpenAI** (Greek call summary); audio/transcript are **not stored**.
  A voice assistant turns spoken Greek into a structured draft via **Anthropic Claude**
  — always **review-first** (nothing is sent/executed without confirmation).

## 4. Core flows

- **Signup → pay → activate** — create account → pick the plan → business + subscription
  created in `pending_payment` → hosted **Stripe Checkout** → Stripe webhook flips it to
  `active`. Managed via the Stripe Customer Portal.
- **Customer → Job → public portal** — a "Job" groups quotes/appointments/messages/photos
  and generates a **secret link** the customer opens without login to accept/reject a
  quote, declare a deposit, upload photos, or chat. Tokens are random, stored hashed
  (SHA-256), and every public action is triple-checked (business + job + state).
- **Inbound call (the heart)** — carrier → PBX (plays disclosure, records) → Twilio →
  the app rings (even backgrounded/killed). On hangup the backend logs the call; a missed
  call creates a "call back" task + notification (+ an after-hours auto-reply). The
  recording is transcribed and summarised; the audio is then deleted.
- **Outbound call** — from the app via Twilio → PBX → carrier, presenting the **business's
  own number** as caller-ID; Greek-only destinations, a per-business daily call cap
  (anti-fraud), recording only when enabled.
- **Messaging & notifications** — Viber (with SMS fallback) and email to customers; push
  to the native apps for missed calls / weekly summary / replies; daily cron jobs for
  scheduled messages, reminders and summaries.

## 5. Technology stack

| Layer | Technology |
|---|---|
| Web | Next.js (App Router), React, TypeScript, Tailwind CSS |
| Backend | Next.js route handlers (Node), modular-monolith services/repos |
| Database / Auth / Storage | Supabase (PostgreSQL) |
| Payments | Stripe (hosted Checkout + Portal) |
| Telephony | Greek SIP carrier + Asterisk PBX + Twilio Programmable Voice + jsSIP (WebRTC) |
| Speech-to-text | Deepgram |
| AI | OpenAI + Anthropic Claude |
| Messaging | SMS/Viber provider + transactional email |
| Push | Firebase Cloud Messaging / Apple APNs |
| Native | Expo / React Native |
| Hosting | Vercel (web+API), a dedicated EU VPS (PBX), Supabase (DB) |
| Monitoring | Sentry |
| Quality gates | 900+ unit tests (Vitest), TypeScript, production build |

## 6. Security posture (honest)

- **Multi-tenant isolation is enforced in code** (the backend uses a privileged DB key
  that bypasses row-level security), made **structural** by a tenant-scoping DB wrapper
  that auto-applies the business filter on every query — backed by tests that prove it
  cannot be mis-tenanted, plus a CI guard against raw, unscoped queries.
- **Public portal** links are random, hashed, and scope-checked on every action.
- **Webhooks** (payments, telephony, messaging) are signature/secret verified.
- **Secrets** are provided via the hosting platforms' environment configuration; none
  live in the repository.
- **Known hardening in progress** (typical for an MVP at this stage): automated CI,
  infrastructure-as-code + off-box backups for the PBX, and durable cross-instance rate
  limiting.

## 7. Cost model (monthly, indicative)

- **Fixed baseline ≈ €60–70/month**: managed web/API hosting, managed Postgres, the PBX
  VPS, Apple developer membership, domain. Most other services (error monitoring, email,
  rate-limit cache, mobile build minutes) sit on free tiers until volume grows.
- **Usage-based (pay-as-you-go)**: call minutes + recording (Twilio), transcription
  (Deepgram), AI summaries/assistant (OpenAI + Anthropic — fractions of a cent each),
  SMS/Viber, Stripe processing (~€1.07 on a €37.14 charge), and the per-number carrier fee
  (~€1.25/number/month).
- The **largest variable** is the Viber sender subscription with the messaging provider
  (estimated; SMS-only avoids it).

---

*This document is a high-level summary. Operational details, infrastructure identifiers
and runbooks are maintained internally.*
