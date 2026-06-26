# Opiflow — Launch Readiness Report

**Date:** 2026-06-26 · **Branch/HEAD audited:** `master` `83afbd8` · **CI:** green
**Method:** 8 parallel grounded audits (one per dimension) + live `/api/health` probe of `https://opiflow.vercel.app`.
This is the single consolidated source for "are we ready for live?". For day-to-day state see `PROJECT_STATE.md`; for the owner setup runbooks see the per-area docs linked at the bottom.

---

## Σύνοψη (TL;DR, Ελληνικά)

**Ετοιμότητα web: ΝΑΙ — μηδέν blockers στον κώδικα, και όλα τα production integrations είναι ήδη LIVE** (`/api/health` → `missingEnv: {}`).
Μένει **ένα** πραγματικό validation gate πριν ανοίξεις το web δημόσια:

1. **Stripe end-to-end test** — φτιάξε λογαριασμό → πλήρωσε → επιβεβαίωσε ότι `business_subscriptions.status` γίνεται `active` και ξεκλειδώνει το τηλέφωνο. *(Πρέπει να το κάνεις εσύ — δεν μπορώ να βάλω στοιχεία πληρωμής.)*

Συν 2 γρήγορες επιβεβαιώσεις DB-side: **migrations 063/064/065 (+059) applied** + `check-migrations.mjs --backfill`, και **`CRON_SECRET` set** (αλλιώς όλα τα crons 503).
Όλα τα υπόλοιπα είναι είτε ήδη live, είτε non-blocking hardening, είτε ξεχωριστό track (app stores / νομικά).

---

## Live production snapshot — `GET /api/health` (2026-06-26)

```json
{
  "ok": true, "service": "opiflow", "coreConfigured": true, "database": true,
  "rateLimitDurable": false,
  "integrations": {
    "anthropic": true, "openai": true, "viber": true, "telephony": true,
    "sipPerUser": true, "webhookSecrets": true, "billing": true,
    "monitoring": true, "twilioVoice": true, "push": true
  },
  "missingEnv": {}
}
```

| Flag | State | Meaning |
|---|---|---|
| coreConfigured / database | ✅ | Supabase + core env live; DB round-trips |
| billing | ✅ | `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` + `STRIPE_WEBHOOK_SECRET` set |
| monitoring | ✅ | Sentry DSNs set (server + client) |
| telephony / twilioVoice / sipPerUser | ✅ | Twilio + per-user SIP env set |
| webhookSecrets | ✅ | shared webhook secrets set |
| anthropic / openai / viber / push | ✅ | AI brief, STT, Viber, FCM server key set |
| **rateLimitDurable** | ⚠️ **false** | Upstash not set → in-memory rate limit only (non-blocking) |
| **missingEnv** | `{}` | nothing the app tracks as required is missing |

> `/api/health` shows ENV presence + a real DB probe; it does **not** show DB **migration** state, `CRON_SECRET`, or the result of the Stripe e2e test — those are confirmed separately (below).

---

## Verdict by dimension

Status legend: **ready** = nothing more needed in-repo · **owner_gated** = code ready, depends on owner action outside the repo · **blocker** = an in-repo gap (none found).

| # | Dimension | Status | In-repo gaps |
|---|---|---|---|
| 1 | Build / CI / Tests | ✅ ready | none |
| 2 | Security / RLS / Multi-tenancy | 🟡 owner_gated | none |
| 3 | Billing / Stripe | 🟡 owner_gated | none |
| 4 | Telephony (Twilio + PBX) | 🟡 owner_gated | none (2 non-blocking cleanups) |
| 5 | Data / Migrations / Jobs | 🟡 owner_gated | none |
| 6 | Mobile / Native / Stores | 🟡 owner_gated | none (1 stale doc) |
| 7 | GDPR / Observability / Legal | 🟡 owner_gated | none |
| 8 | Canonical state / blockers | 🟡 owner_gated | none |

**No in-repo blockers in any dimension.** Every remaining item is an owner action outside the repo.

---

### 1. Build / CI / Tests — ✅ ready
- CI (`.github/workflows/ci.yml:5-9`) runs on push + PR to `master`; web job gates `tsc --noEmit` (line 29), `vitest run` (31), `next build` (33); native job gates native `tsc` (57-59). Confirmed green on `master` HEAD.
- `next build` cannot fail on missing prod env: CI supplies placeholders (`ci.yml:39-41`) and env is read **lazily inside handlers**, not at module load (`src/lib/supabase/server.ts:13-20`, `src/app/api/webhooks/stripe/route.ts:18` → 503 `not_configured` if unset).
- `next.config.ts` has **no** `ignoreBuildErrors`/`ignoreDuringBuilds` — build genuinely gates tsc + lint. Sentry fully env-gated (`next.config.ts:106-118`).
- **Zero skipped/quarantined tests** (no `.skip/.only/.todo`); critical paths covered: billing webhook (`webhooks-stripe.test.ts`), multi-tenant (`tenant.test.ts` + `tenant-isolation-audit.test.ts:74-113`).
- Local re-verify: vitest **936 passed** (95 files), web tsc 0, native tsc 0, `next build` 0.
- **Owner action:** none. *(Optional: enable GitHub branch protection requiring the `Web` + `Native` checks before merge — verify in repo settings.)*

### 2. Security / RLS / Multi-tenancy — 🟡 owner_gated (no in-repo gaps)
- `tenantDb` (`src/server/core/tenant.ts:41-66`) structurally forces `.eq('business_id', …)` on select/byId/update/delete + injects it on insert. The isolation audit test (`tenant-isolation-audit.test.ts:25-114`) fails the build if any new module uses the raw service-role client off-allowlist. **11/11 isolation tests pass.**
- Central auth `authenticateBusinessRequest` (`src/lib/api/auth.ts:111-143`); every API route enforces auth in-handler (no `middleware.ts`). Owner/manager role gates on account-delete, billing/*, bank-accounts, phone/recording, disclosure-audio.
- Webhook signatures verified + **fail-closed in prod**: Stripe HMAC timing-safe (`src/lib/billing/stripe.ts:86-106`), Twilio `validateRequest` (inbound/recording), PBX/Apifon shared-secret (`webhook-secret.ts:10-16`). Public `/f/<token>` flows hash the token before any lookup and fail closed.
- Secret hygiene: only `.env.example` tracked; regex sweep found **no live secrets** in source. Recording download has an SSRF guard (`twilio-recording.ts:74`, https + `*.twilio.com` only).
- **Owner actions:** set `UPSTASH_REDIS_REST_URL`/`_TOKEN` (durable rate-limit; `rateLimitDurable:false` now — non-blocking); confirm migrations 028 + 034 (RLS defense-in-depth) applied; rotate the Supabase service-role key + historical PAT.

### 3. Billing / Stripe — 🟡 owner_gated (no in-repo gaps)
- Self-serve loop complete: signup writes `pending_payment` (NOT entitled) (`businesses-create.ts:248`); checkout owner-only + gated on `isStripeConfigured() && STRIPE_PRICE_ID` (`billing/checkout/route.ts:10,16`) → hosted Checkout (no publishable key, no Stripe.js).
- Webhook flips status → `active` on `checkout.session.completed` (`webhooks-other.service.ts:64`), **persists `stripe_customer_id`/`subscription_id`** (53-74), returns 500 on DB failure so Stripe retries (idempotent upsert).
- Customer Portal resolves by stored `stripe_customer_id` first, email only as legacy fallback (`billing.service.ts:70` → `getStripeCustomerId`).
- Path B (tax-inclusive €37.14) needs no code: single price source `src/lib/billing/plans.ts`. Graceful degradation: upgrade/manage buttons hidden when `/api/health` billing=false. **18 billing/webhook tests pass.**
- **`/api/health` confirms `billing: true` LIVE** — Stripe keys/price/webhook-secret are set in production.
- **Owner actions:**
  - **▶ RUN THE STRIPE E2E TEST (the last gate before web publish)** — fresh account → «Πληρωμή & ενεργοποίηση» → pay (test `4242…` then a live smoke) → confirm `business_subscriptions.status` = `active` + phone unlocks.
  - Confirm migrations **064 + 065** applied (portal/reconciliation detail columns; tolerant no-op if not).
  - In Stripe Dashboard: confirm the **production webhook endpoint** = `…/api/webhooks/stripe` subscribed to `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed`; confirm the **Customer Portal is saved**; confirm post-pay redirect host (`checkout/route.ts:20` uses request `origin`, falls back to `https://opiflow.ai`).
  - Confirm Path B VAT handling (no Stripe Tax → owner self-remits 24% ΦΠΑ + compliant Greek invoicing).

### 4. Telephony (Twilio + Asterisk PBX) — 🟡 owner_gated
- `twilio-token` gate real (number-assigned + entitled) before minting; region pinned `us1`; env-gated inert when unset (`phone/twilio-token/route.ts:46,85,68`). `browser-token` refuses the shared SIP credential when >1 business unless `PHONE_SIP_SHARED_OK=1`.
- Outbound webhook: signature fail-closed in prod; **Greek-geo + mobile allowlist only** (excludes premium/intl/shortcodes); `<Dial timeLimit>` cap; per-business daily cap (default 200/24h) (`twilio/outbound/route.ts` + `webhooks-voice.service.ts:712`).
- Inbound webhook: signature fail-closed; DND reject-as-busy; block-list reject (migration 058); fail-**open** on DB hiccup by design (ringing prioritized).
- **OWN-VOICE outbound disclosure is LIVE** — shipped via PR #302 + #384 (the `[opiflow-outbound]` Gosub is on HEAD in `scripts/provision-asterisk.py:451-479`). *(PR #301 is a stale OPEN duplicate — close it.)*
- Recording→brief pipeline deletes the Twilio cloud recording on success/invalid/redelivery; `recordings-reconcile` cron backstop. WAV in RAM only.
- **Owner actions:** set Twilio env in Vercel (*health says `telephony:true` — already set*); confirm the **live Asterisk box** (`root@46.224.138.115`, NOT in git) has the disclosure dialplan wiring + the per-minute provisioner cron; physical device-test killed-app inbound ring; do the s34 PBX tech-access cleanup (`deluser opadmin`, `ufw delete allow 9090`) + rotate `PBX_WEBHOOK_SECRET` if exposed.
- **Non-blocking cleanups:** close stale PR #301; inbound exempt-numbers Asterisk skip is a future PBX change (API/storage exist via migration 060; dialplan skip not yet wired).

### 5. Data / Migrations / Jobs — 🟡 owner_gated
- Migrations on disk **001–065** (049 intentionally skipped). Launch-relevant 060–065; all tolerant (degrade gracefully if unapplied):
  - **060** `business_exempt_numbers` — exemption list no-ops if absent.
  - **061** self-serve billing (`stripe_customer_id`/`subscription_id` + status CHECK) — billing gate effectively OFF if absent (falls back to legacy entitled status, no lockout).
  - **062** customer phone indexes — inbound caller→customer lookup is a seq-scan if absent (perf only).
  - **063** `outbox_events` — needed only by the dormant outbox cron.
  - **064** stripe subscription details — portal/reconciliation detail columns; webhook write is tolerant.
  - **065** `schema_migrations` tracking table (self-records; 060–064 lack self-record lines → need backfill).
- `scripts/check-migrations.mjs` diffs disk vs DB (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in env); `--backfill` marks 001–064 once.
- **6 vercel.json crons**: intake-reminder, scheduled-messages, recordings-reconcile, folder-unread-reminder, weekly-summary, outbox. **ALL call `checkCronSecret()` → 503 in prod if `CRON_SECRET` unset** (`cron-auth.ts:15-18`).
- **Outbox/jobs worker = dormant scaffolding**: `cron/outbox/route.ts:33` returns `skipped:'worker_disabled'` unless `WORKER_ENABLED='1'`; and no send-site enqueues yet, so even enabled it drains an empty queue. Correct launch posture: leave OFF.
- **Owner actions:** apply **060–065** in Supabase SQL editor (`oluhmztfimmgmbxoioea`); run `check-migrations.mjs --backfill` once after 065; **set `CRON_SECRET` in Vercel** (or all crons 503); leave `WORKER_ENABLED` off.

### 6. Mobile / Native / Stores — 🟡 owner_gated (web go-live is independent)
- iOS non-call push code-complete + merged (`native/src/lib/push.ts:85-89`, `app.json:13,75`, `GoogleService-Info.plist` committed). **EAS build verified + build 33 submitted to TestFlight.**
- Incoming-call VoIP/CallKit live (owner-confirmed in prod). Android push code-complete (`google-services.json` committed). `eas.json:25-36` submit config present.
- Native app is a real Expo/RN app (14 route screens) — lowers App Store 4.2 rejection risk. Store copy ready in `docs/STORE_LISTING.md`.
- **Owner actions:** iOS **on-device TestFlight test of build 33** (install → login → grant permission → confirm `device_push_tokens` `platform:ios` row → trigger a push); App Store listing + Submit for Review; Android `play-service-account.json` (owner secret, not in repo) + `eas submit -p android` + Play listing/Data-Safety; confirm `TWILIO_PUSH_CREDENTIAL_SID_ANDROID` set (health `push:true`); decide native app-icon branding (still indigo `#2563EB`, not water-blue `#2A86C5`).
- **Stale doc:** `docs/IOS_LAUNCH_STEP_BY_STEP.md` describes a Capacitor/Codemagic path; the real path is Expo/EAS — delete or rewrite.

### 7. GDPR / Observability / Legal — 🟡 owner_gated
- Sentry fully env-gated + PII-safe (`sendDefaultPii:false`); **health `monitoring:true` LIVE**.
- GDPR account deletion complete: owner-gated, audit-logged, Storage purge + explicit per-table cascade + `ON DELETE CASCADE` FKs + fail-loud auth-user delete (`account.service.ts`, `account.repo.ts`). Data export CSV (`ImportExportPanel.tsx`).
- Legal pages present + named entity: `privacy/page.tsx` + `terms/page.tsx` name **Αντιπλημμυρικά Ελλάδος ΙΚΕ (ΓΕΜΗ 194339601000, ΑΦΜ 803311450)**, GDPR rights, sub-processors, single plan 29,95€+ΦΠΑ (37,14€ incl.), auto-renew, 14-day withdrawal, Greek law/Athens courts; linked from footer + public portal + intake.
- Call-recording: disclosure plays **before** MixMonitor (inbound + outbound), record-calls master toggle owner-gated — legally correct order under N.3471/2006 + GDPR.
- **Owner actions:** confirm migrations **059 + 055** applied (recording toggle + disclosure audio); ensure every live business has a disclosure clip (default fallback plays otherwise — recording w/o disclosure is unlawful); resolve the **EETT / telephony subscriber-obligations split** for the InterTelecom pseudo-number (external legal); lawyer/DPO review of Privacy+Terms + a **DPA** with business customers.

### 8. Canonical state / blockers — 🟡 owner_gated
- `PROJECT_STATE.md:24` (s36) canonical pre-publish gate: **(a) Stripe e2e test = THE last gate**, (b) Upstash (optional), (c) native icon a/b/c, (d) a new EAS build.
- **Now-stale in PROJECT_STATE / memory (already done this session):** CI workflow (P0 "add via GitHub UI") is **shipped** (`.github/workflows/ci.yml`); iOS push is **wired + built + on TestFlight**; Stripe customer-id, migration tracking (065), and outbox senders all shipped.
- **Owner actions:** the Stripe e2e test; apply 063/064/065 + backfill; iOS device test; native icon decision + new EAS build (EAS free credits exhausted → billed, ask owner first); legal/DPA; confirm `TWILIO_PUSH_CREDENTIAL_SID_ANDROID`; Upstash; key rotation + backups/PITR + uptime monitor.

---

## Consolidated owner checklist

### 🔴 Gate before web publish (must pass)
- [ ] **Stripe end-to-end test** — signup → pay → `business_subscriptions.status` = `active` → phone unlocks. *(Owner-only; assistant cannot enter payment.)*
- [ ] **Apply migrations 063 / 064 / 065** (and confirm **059**, **055**) in the live Supabase SQL editor, then run `node scripts/check-migrations.mjs --backfill` once.
- [ ] **Confirm `CRON_SECRET` is set** in Vercel (else all 6 crons return 503).

### 🟡 Strongly recommended before/at launch (non-blocking)
- [ ] Set `UPSTASH_REDIS_REST_URL` + `_TOKEN` (durable cross-instance rate limiting; `rateLimitDurable` currently false).
- [ ] Rotate Supabase service-role key + historical PAT + Stripe keys; never commit.
- [ ] Supabase Pro backups/PITR + a tested restore; external uptime monitor on `/api/health`.
- [ ] PBX s34 tech-access cleanup (`deluser opadmin`, `ufw delete allow 9090`) + rotate `PBX_WEBHOOK_SECRET` if exposed.
- [ ] Close stale PR #301; delete/rewrite `docs/IOS_LAUNCH_STEP_BY_STEP.md`.

### 📱 Native app stores (separate track — does NOT block web)
- [ ] iOS: on-device TestFlight test of build 33 → App Store listing + Submit for Review.
- [ ] Android: provide `play-service-account.json`; `eas submit -p android`; Play listing + Data Safety; confirm `TWILIO_PUSH_CREDENTIAL_SID_ANDROID`.
- [ ] Decide native app-icon branding (`#2563EB` → water-blue `#2A86C5`) → new EAS build (billed — confirm first).

### ⚖️ Before scaling to many paying customers
- [ ] Lawyer/DPO review of Privacy + Terms; DPA with business customers.
- [ ] Resolve the EETT / InterTelecom pseudo-number subscriber-obligations split (written carrier confirmation).
- [ ] Greek myDATA invoicing decision for the €37.14 Path B billing.

---

## Where each area's detail lives
- Current state / changelog / infra IDs — `PROJECT_STATE.md`
- Stripe setup — `docs/BILLING_SELF_SERVE_SETUP.md`
- iOS push runbook — `docs/NATIVE_PUSH_SETUP.md`
- Android release — `docs/ANDROID_RELEASE.md` · store copy — `docs/STORE_LISTING.md`
- PBX / InterTelecom — `docs/PBX_SETUP_FOR_INTERTELECOM.md` · `infra/pbx/`
- Deploy — `docs/DEPLOY.md` · costs — `docs/SETUP_AND_COSTS.md`
- Prior audits — `docs/MVP_READINESS_AUDIT.md`, `docs/PRODUCT_READINESS_REVIEW_2026-06-12.md`, `docs/LAUNCH_CHECKLIST.md`

*Generated by the 2026-06-26 launch-readiness audit (8 grounded sub-audits + live `/api/health`). Re-run that audit and refresh this file before flipping the public switch.*
