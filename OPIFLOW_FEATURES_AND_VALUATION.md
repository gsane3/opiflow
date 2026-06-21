# Opiflow — Feature Inventory & Valuation

> Companion to `OPIFLOW_BUSINESS_BRIEF.md`. Two parts: (1) a full, code-grounded feature
> inventory; (2) a product/IP valuation + a 20/50/100/1000-subscriber projection. The valuation
> numbers below are the **corrected** figures after an adversarial review pass — the first-pass
> model was ~2x too high (it under-counted CAC, churn, the Apifon minimum, and the EETT/legal
> risk, and over-valued the cost-to-build floor). Derived 2026-06-21. Status: ✅ shipped · ◐ partial · ○ planned.

---

## PART 1 — Feature inventory (~150 features, 8 domains)

### A. Telephony / business-phone (19)
✅ In-app outbound calling (Twilio Voice SDK → Asterisk → InterTelecom, business DID as caller-ID, branded in-call overlay: mute/speaker/DTMF/timer/hangup) · ✅ In-app inbound calling (rings the device, branded answer/decline) · ✅ CallKit/ConnectionService native call UI · ◐ VoIP push / ring-when-killed (iOS confirmed working; Android FCM credential owner-pending) · ✅ Inbound recording (Asterisk MixMonitor, RAM-only) · ✅ Outbound recording (Twilio dual-channel, auto-deleted) · ◐ Voicemail-to-text (server complete, Asterisk dialplan pending) · ✅ Missed-call funnel (status + auto call-back task + owner push) · ✅ AI call brief · ◐ Ringback status · ✅ Recording-disclosure own-voice (legal, LIVE) · ◐ Do-Not-Disturb · ✅ Business-hours / after-hours auto-reply to caller · ✅ Block contact/number (rejected at the carrier webhook) · ✅ Recent-calls list + redial · ✅ Per-call action sheet (brief, chips→tasks, block, reject, delete) · ✅ End-of-call intake prompt · ✅ Browser/web softphone (jsSIP) · ✅ Telephony onboarding (native vs call-forward) · ✅ Outbound abuse hardening (allowlist/daily-cap/quota) · ✅ Server-side call logging + reconciliation · ○ Telnyx alt-carrier stub

### B. AI (11)
✅ Call transcription (Deepgram diarized + OpenAI fallback) · ✅ AI call brief with next-steps (gpt-4o) · ✅ Post-call AI-draft task derivation · ✅ `/cmd` voice command assistant (Claude Haiku — "start project / send offer / book appointment") · ✅ AI reply-draft in chat · ✅ Customer-memory synthesis «Σύνοψη από κλήσεις» · ✅ AI review (free text → structured CRM data) · ✅ Suggested-action chips (deterministic) · ✅ Next-Best-Action ranker (deterministic) · ✅ Attention/reminder engine (deterministic) · ○ Speculative metadata brief (intentionally disabled — anti-hallucination)

### C. CRM / customers / contacts (26)
✅ iOS-Contacts A–Z sectioned list + ✅ A–Z index scrubber · ✅ Search (name/phone/company/email) · ✅ Status quick-filters · ✅ «Αναμονή στοιχείων» derived filter · ✅ Pagination · ✅ Manual create · ✅ Per-business CRM number assignment · ✅ Customer profile + full field set · ✅ Edit sheet · ✅ Phone normalization · ✅ Sales pipeline/status · ✅ Intake-status lifecycle + «Λείπουν στοιχεία» pinning · ✅ Internal note · ◐ AI memory fields (business/personal notes + status summary) · ◐ Pinned active jobs · ✅ Hide phone-imported (default on) · ✅ Import from phone address book · ✅ Import from CSV (old CRM) · ✅ CSV export · ◐ Dedup by phone · ✅ Delete single / ✅ bulk imported / ✅ bulk ALL · ✅ Block/unblock · ✅ Reject (mark lost) · ✅ NBA card · ✅ Business isolation

### D. Projects (Έργα), Offers (Προσφορές), Payments (19)
✅ Work folders/projects per customer · ✅ Project process/timeline screen · ✅ Share project portal link · ✅ Public customer portal hub (`/f/[token]`) · ✅ Offer builder (line items, qty, VAT, notes) · ✅ Per-business running offer numbering · ◐ Valid-until + expiry guard · ✅ Offer PDF · ✅ Offer CRUD + status API · ✅ Offer send + response link · ✅ Customer accept/reject · ✅ Opportunity value · ✅ Offer→pipeline status automation · ✅ Payment requests (deposit/balance) · ✅ Bank settings · ✅ Portal payment declaration «Δήλωσα την κατάθεση» · ✅ Owner confirm/cancel payment · ✅ Per-folder NBA + Attention · ✅ Offers list + analytics

### E. Messaging & delivery (22)
✅ Apifon Viber sender (action-button + text) · ✅ Apifon SMS · ✅ Preferred-channel dispatcher (Viber→SMS fallback) · ✅ Email via Resend · ✅ Reusable Greek snippets/templates · ✅ Scheduled send-later messages · ◐ Scheduled-dispatch cron · ○ Auto-cancel on customer reply · ✅ After-hours auto-reply · ✅ Delivery-status webhook tracking · ✅ Timeline logging + provider rows · ✅ Intake public link · ✅ Upload (photo/video) public link · ✅ Appointment-response public link · ✅ Offer-response public link · ✅ Free-text chat send (backend) · ✅ Optimistic chat (instant bubbles) · ✅ Public portal chat (2-way + live read) · ✅ WhatsApp/email operator deep-links · ✅ Intake reminder + token-expiry cron · ◐ Weekly summary + unread reminder

### F. Appointments · Tasks · Calendar · Notifications · Stats · Search (27)
✅ Appointments agenda (web) / ◐ native · ✅ Time-change accept/reject (web + notifications inbox) · ✅ Public appointment-response flow · ✅ Tasks (web) / ◐ native · ✅ .ics export · ✅ Calendar day/week (web + native) · ✅ Intake-reminder + other crons · ✅ After-hours automation · ✅ Per-customer/folder next-action + attention · ✅ Notifications/attention inbox (web bell) / ◐ native · ✅ Notifications aggregation (calls excluded) · ✅ Stats/KPIs (web) / ◐ native · ✅ Global search (web + native) · ◐ Weekly summary push · ✅ Maps button

### G. Native app · onboarding · settings · auth · team (28)
✅ Native iOS/Android shell (Capacitor/Expo Router) · ✅ Screen parity with web · ✅ In-app voice calling + incoming ring · ◐ Killed-app iOS VoIP push · ✅ Onboarding wizard (5 steps) + ✅ activation gating · ✅ Flattened settings (drill-in hub) · ✅ Business-profile editing · ✅ Logo upload from phone · ✅ Snippets CRUD · ✅ Hours & automations · ✅ Bank accounts · ✅ Service catalog CRUD · ✅ In-app disclosure recorder · ✅ Telephony status panel · ✅ Manual photo upload to customer files · ✅ Email/password + ✅ Google/Apple OAuth (native + web) · ✅ Session/token management · ✅ Account deletion / GDPR erasure · ✅ Contact-data deletion · ✅ Team/multi-user (web) / ◐ native · ✅ Subscription view (native, read-only) · ✅ Theme/dark mode · ✅ Account & support links · ✅ In-app AI assistant sheet

### H. Platform · security · infra · admin · billing (18)
✅ Multi-tenant API auth + business-isolation guard · ✅ Row-Level Security · ✅ Service-role isolation + scoped queries · ✅ Rate limiting (Upstash in prod, fails open, 12 endpoints) · ✅ Public-link token security (SHA-256 hashed, never stored raw) · ✅ Webhook signature verify + fail-closed (Twilio/PBX/Apifon/Stripe) · ✅ Constant-time secret compare · ✅ Cron auth + scheduled jobs · ◐ Sentry observability · ◐ Security headers + CSP · ✅ GDPR right-to-erasure · ◐ Audit logging · ✅ Stripe checkout + portal · ◐ Stripe webhook → activation · ◐ Entitlement model (trial→active→block) · ✅ Number-pool admin console · ✅ Number lifecycle (atomic assign/cooldown/release) · ✅ Admin auth guard · ◐ Push (FCM/APNs) · ◐ Per-user SIP credential encryption-at-rest · ✅ Twilio token minting · ✅ Env validation + health reporting

**Maturity:** the overwhelming majority is **shipped**; the `◐ partial` items are mostly
native-parity gaps or env-gated infra (FCM/APNs, Sentry, voicemail dialplan, entitlement
enforcement) — wiring/config, not new product.

---

## PART 2 — Product / IP valuation (today, pre-revenue)

**Method: replacement / cost-to-build + strategic floor** (revenue multiples don't apply until
ARR is material). Honest bottom-up: a solo founder built this in ~9–15 calendar-months, much of
it on managed platforms (Twilio SDK, Supabase, Stripe, Expo, Deepgram/OpenAI) that compress
build time → realistic rebuild ≈ **20–40 engineer-months** at a Greek/CEE-realistic €7–10k
fully-loaded/eng-month ≈ €0.18–0.40M raw build cost. Apply a steep unproven-IP discount (zero
revenue validation) and a deduction for the PBX ops-liability (single un-versioned Hetzner box,
root SSH, single-vendor telephony lock):

| Basis | Value (EUR) |
|---|---|
| **Defensible IP/asset floor (today)** | **€0.20M – €0.45M** (point ~€0.30M) |
| Strategic acqui-value (named Greek/EU buyer, build-vs-buy + InterTelecom relationship) | up to ~€0.6M – €1.0M — **trimmed for the EETT/legal overhang** |

> The strategic premium is *conditional*: the "dedicated Greek number per tenant" asset is
> currently **legally unresolved + per-tenant inbound provisioning is blocked** (EETT
> subscriber-of-record question). A telecom-savvy buyer treats that as an indemnity/escrow item,
> not upside.

## PART 3 — Valuation projection at 20 / 50 / 100 / 1000 subscribers

Assumes ARPU **€39/mo flat**. Per-tenant all-in COGS ≈ carrier (€5 typical) + ~€6.25 usage +
€1.17 Stripe + shared-fixed/N. Shared fixed = €55/mo, **+€150/mo if the Apifon plan minimum is
mandatory** (likely — Viber is a core channel; this cuts low-N margins hard).

| Subs | ARR (€) | Typical gross margin | Valuation **base** | Valuation range | What sets the value |
|---|---|---|---|---|---|
| **20** | 9.4k | ~61% (42% w/ Apifon min) | **€0.30M** | €0.25–0.6M | IP/asset floor — ARR immaterial |
| **50** | 23.4k | ~65% | **€0.40M** | €0.3–0.7M | IP floor + early-traction premium |
| **100** | 46.8k | ~67% | **€0.45–0.5M** | €0.35–0.9M | floor-governed (3× ARR=€140k & 4.5× SDE≈€100k both < floor) |
| **1000** | 468k | ~68% (blended ~70–75%) | **€1.0–1.2M** | €0.7–2.3M | ARR/SDE band: ~2.0–2.5× ARR base; ~5× ARR strategic high |

**Reading it:** below ~€0.5M ARR the **cost-to-build / strategic floor governs** — going from 20
to 100 paying customers barely moves enterprise value (it proves the model, it doesn't yet
compound). Real multiple-driven value starts around **1000 subs / ~€0.5M ARR**, where a base of
~**€1.0–1.2M** (2–2.5× ARR after single-founder + Greece-concentration + telephony-dependency +
unproven-retention discounts) is defensible, with a strategic ceiling ~€2.3M.

## PART 4 — What gates these numbers (be honest in the plan)

1. **CAC is the binding constraint, not COGS.** Zero paying tenants today. At €39 ARPU a
   blended CAC of €200–350 + SMB churn ~3%/mo means a 1000-sub base needs ~300–400 replacement
   logos/yr — €75–100k/yr of marketing **alone**, which collapses the naïve "€318k gross profit"
   to a realistic SDE of ~€80–160k. **Find a low-CAC channel before trusting the high cases.**
2. **Churn.** SMB SaaS churns ~3–4%/mo. A "held" N is a treadmill; a >35%/yr-churn micro-SaaS
   trades at ~1.5–2.5× ARR, not 3.5×+. NRR ≥100% is the gate to a higher multiple.
3. **Apifon €150/mo minimum** is probably **mandatory** (Viber is core) → fold into fixed cost;
   it cuts N=20 margin from ~61% to ~42%.
4. **EETT/legal** on per-tenant numbers is unresolved and **blocks per-tenant inbound today** —
   the single biggest risk to the core model and the strategic premium.
5. **Heavy users are loss-leaders** on a €39 flat plan (~5–12% margin) — needs a fair-use cap or
   metered overage; trial users burn real telephony+AI COGS (uncapped without metering).
6. **Single-founder + single-country + single-carrier** = stacked valuation discounts a buyer
   will apply. Documenting ops + a #2 hire recovers part of it.

*All figures EUR, single-buyer private-transaction basis (marketplace/micro-PE pool, not VC),
cash-free/debt-free, snapshot (churn/growth noted, not time-modelled). Validate the [VALIDATE]
items in OPIFLOW_BUSINESS_BRIEF.md before locking any number.*
