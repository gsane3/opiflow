# Opiflow — Business & Planning Brief (for the 2-year plan)

> **Purpose & how to use this file.** This is a **self-contained brief** to paste into a fresh
> Claude project whose job is to build a **2-year forecast + goals** for Opiflow. It has zero
> external dependencies: product, current status, the real cost structure / unit economics,
> pricing, the open unknowns, and a ready-to-fill planning template. Numbers marked
> **`[VALIDATE]`** are external/assumed — the planning project must confirm them. Numbers from
> the codebase cost audit (2026-06-21) are derived and labelled. FX used: USD→EUR ≈ 0.92.

---

## 1. The product (one paragraph)

**Opiflow** is a Greek, mobile-first **business-phone + CRM** for solo service technicians and
small trades (plumbers, electricians, HVAC, etc.). Each business gets a **dedicated Greek phone
number**; every call is logged, recorded, transcribed and turned into an **AI brief** with
next-step actions. Around the phone sits a lightweight CRM: customers, projects/jobs, offers
(PDF), appointments, payments, and customer messaging over **Viber/SMS/email**. A voice-driven
**AI assistant** lets the technician run the app hands-free ("start a project", "send an offer",
"book an appointment"). Web app (Next.js) + native iOS/Android (Capacitor + Twilio Voice SDK).

- **Live web:** https://opiflow.vercel.app · **Repo:** `gsane3/opiflow`
- **Market:** Greece first (Greek UI, Greek DIDs, Greek messaging/legal). Single-operator SMBs.
- **Wedge:** "your work phone that remembers everything and does the paperwork for you."

## 2. Current status (as of 2026-06-21)

- **Built & shipped:** full CRM, telephony (in-app calls that ring when the app is killed —
  confirmed working), call recording → transcription → AI brief, offers/appointments/payments,
  Viber/SMS/email delivery, AI command assistant, contact import, block-contact, native parity.
- **Stage:** feature-complete MVP in final testing; iOS on TestFlight (build 28), Android APK.
  **Pre-revenue** — Stripe subscription billing is code-ready but the entitlement model
  (trial→active→block) is not enforced yet.
- **Blockers before scaled selling:** (a) InterTelecom managed-number model needs commercial +
  **legal/EETT** confirmation (reseller obligations); (b) Apifon contract; (c) per-minute
  carrier rate; (d) on-device QA pass.

## 3. Cost structure (the inputs that drive the model)

### 3a. Fixed / shared costs — one set of accounts serves ALL tenants
| Item | €/mo | Notes |
|---|---|---|
| Supabase Pro | 23 | DB/auth/storage; needed for no-pause + backups |
| Vercel Pro | 18.4 | hosting; commercial license |
| Hetzner VPS | 4.5 | the Asterisk PBX |
| Apple Developer | 7.6 | $99/yr ÷ 12 |
| Domain (.gr) | 1.0 | |
| Resend | 0 | free ≤3,000 emails/mo |
| **Subtotal** | **≈ 55** | + Google Play $25 one-time |
| **Apifon plan** | **≈ 150 `[VALIDATE]`** | likely monthly Viber minimum — **biggest unknown fixed cost** |
| Sentry (optional) | ~24 | recommended at scale |

**Amortization per tenant** (fixed ÷ N customers) — this dominates early economics:

| N customers | €55 base only | €55 + €150 Apifon |
|---|---|---|
| 5 | 11.0 | 41.0 |
| 10 | 5.5 | 20.5 |
| 20 | 2.8 | 10.3 |
| 50 | 1.1 | 4.1 |
| 100 | 0.55 | 2.05 |

### 3b. Variable costs — per tenant, with usage
Per-unit (EUR), derived from the 2026 vendor audit:

| Driver | Unit | Cost |
|---|---|---|
| Twilio voice (SDK+SIP legs) | per in-app call minute | 0.0074 |
| InterTelecom carrier (KNOWN) | monthly talk bundle, per number | **€5 / 500 min** or **€13 / 1500 min** (to all, 30 days) |
| Twilio recording (outbound only, dual) | per recorded min | 0.0046 |
| Transcription (Deepgram nova-2 + diarization) | per recorded min | 0.0058 |
| AI call brief (OpenAI gpt-4o) | per recorded call | ~0.006 |
| AI assistant (Claude Haiku) | per /cmd action | ~0.003 |
| Messaging (Apifon, blended Viber+SMS) | per message | ~0.020 |
| Dedicated number (DID) | per month | 1.25 (€15/yr) |

### 3c. Per-tenant all-in COGS (steady state, N=20, carrier bundle €5/€13 + Stripe 3%)
| Profile | Usage | €/mo |
|---|---|---|
| **Light** | ~40 calls, no recording, ~30 msgs (carrier €5) | **~9–10** |
| **Typical** (median solo is light→typical) | ~120 calls, 60% recorded, ~70 msgs (carrier €5) | **~14–15** |
| **Heavy** (really a 2–3 person crew) | ~300 calls, 90% recorded, ~150 msgs (carrier €13) | **~36–37** |

> The known €5 carrier bundle is a per-number **floor** every tenant pays, so it raises light/typical
> COGS vs the old per-minute guess but makes telephony predictable. Gross margin at €39 stays
> ~61–67%. Early-stage: at **N=5** add ~€8/tenant fixed amortization. If the Apifon €150 minimum
> is mandatory (likely), add the 3b-Apifon column until volume absorbs it (cuts N=20 margin to ~42%).
> Full corrected economics + valuation: see `OPIFLOW_FEATURES_AND_VALUATION.md`.

## 4. Pricing & margin (current hypothesis — `[DECIDE]`)

- **Single flat plan €39/mo** → ~€27 contribution on a Typical tenant (~69% gross margin);
  still positive on Heavy except the worst InterTelecom case.
- **Or two tiers:** Starter **€29** (light/typical) + Pro **€59** (heavy / multi-seat) — protects
  the heavy tail and the carrier-rate unknown.
- Stripe takes ~3% of revenue (≈€1.2 on €39), out of price, not COGS.
- **Free trial** (e.g. 14 days) is a real COGS line — a trial user still burns calls/AI; budget it.

## 5. Unit-economics formulas (for the model)

```
contribution_per_tenant   = price − variable_COGS_per_tenant           (e.g. 39 − 12 = 27)
gross_margin_%            = contribution / price                        (e.g. 69%)
breakeven_N              = fixed_monthly / contribution_per_tenant     (e.g. (55+150) / 27 ≈ 8 tenants)
LTV                      = contribution_per_tenant × avg_lifetime_months
avg_lifetime_months      = 1 / monthly_churn
CAC_payback_months       = CAC / contribution_per_tenant
LTV:CAC                  = LTV / CAC                (target ≥ 3)
MRR                      = end_customers × ARPU
net_new_customers        = gross_adds − churned    (churned = start_customers × monthly_churn)
```

## 6. Assumptions the planning project MUST set (placeholders)

| Variable | Placeholder `[VALIDATE/DECIDE]` | Why it matters |
|---|---|---|
| TAM — # of target Greek SMB technicians | `[RESEARCH]` (ELSTAT/GEMI: plumbers, electricians, HVAC, handymen, small contractors) | ceiling on customers |
| SAM/SOM — realistic reachable share | `[DECIDE]` | sets the customer ramp |
| ARPU / price | €29–59 `[DECIDE]` | revenue per customer |
| Monthly churn | `[VALIDATE]` (SMB SaaS often 3–6%/mo) | lifetime + LTV |
| CAC & channel | `[DECIDE]` (referrals, FB/IG, trade groups, direct) | payback, burn |
| Trial→paid conversion | `[VALIDATE]` | funnel efficiency |
| Carrier (InterTelecom) | **KNOWN: €5/500min or €13/1500min per 30 days, to all** | COGS floor per number |
| Apifon monthly minimum | `[VALIDATE]` | early fixed cost |
| Customer ramp (adds/quarter) | `[DECIDE]` | the whole forecast |
| Team/founder costs, your salary | `[DECIDE]` | true P&L / burn |

## 7. Illustrative 2-year skeleton (fill the bold cells — numbers are EXAMPLES `[VALIDATE]`)

ARPU €39, Typical COGS €12, fixed €55 base (+ Apifon once contracted), churn `[set]`.

| Quarter | New | Churned | **End customers** | **MRR €** | **COGS €** | **Gross €** | **Fixed €** | **Op result €** |
|---|---|---|---|---|---|---|---|---|
| Q1 (launch) | 5 | 0 | 5 | 195 | 60 | 135 | 205 | −70 |
| Q2 | 10 | 1 | 14 | 546 | 168 | 378 | 205 | +173 |
| Q3 | 18 | 2 | 30 | 1,170 | 360 | 810 | 205 | +605 |
| Q4 | 25 | 4 | 51 | 1,989 | 612 | 1,377 | 205 | +1,172 |
| Y1 end | | | **~51** | **~2.0k** | | | | |
| Q5–Q8 | … | … | **[ramp]** | | | | | |
| Y2 end | | | **[target]** | **[target MRR]** | | | | |

> The example uses €205 fixed = €55 base + €150 Apifon. Swap in real ramp/churn/ARPU. Add rows
> for cash balance and CAC spend to get a runway view. Run **3 scenarios**:
> **Conservative / Base / Aggressive** (vary adds + churn + conversion).

## 8. Goals framework (set targets against these)

- **North-Star metric:** weekly active technicians who logged ≥1 AI-briefed call (proves the
  core loop is used, not just installed).
- **KPI tree:** Acquisition (trials/mo, CAC) → Activation (onboarded + got a number + 1st call)
  → Retention (monthly churn, NRR) → Revenue (MRR, ARPU, LTV:CAC ≥ 3, CAC payback ≤ 6mo) →
  Efficiency (gross margin ≥ 65%, COGS/tenant).
- **Suggested milestones to set numbers for:** first 10 paying · breakeven N (≈8–10 at €39) ·
  €1k MRR · €5k MRR · legal/EETT clearance · 100 customers · positive cash-flow month.

## 9. Strategic risks for the plan to address

1. **Legal/EETT (highest):** reseller-of-numbers obligations (112, subscriber registry,
   portability) are unconfirmed — could cap how many numbers Opiflow can hold. May force a
   "bring-your-own-number" or partner-carrier model. Get a telecoms lawyer + IT's written terms.
2. **Manual provisioning:** numbers are bought/placed by email per customer (no API) — fine to
   ~50 customers, a scaling bottleneck after. Plan automation or a carrier with an API.
3. **Single-PBX SPOF:** one Asterisk VPS serves everyone; plan monitoring/failover before scale.
4. **Apifon dependency & cost:** the messaging channel + its monthly minimum; have an SMS-only
   or alternative-provider fallback in the model.
5. **Carrier-rate unknown** swings COGS at heavy usage — price with a fair-use cap until known.

---

*Companion files in the repo: `docs/SETUP_AND_COSTS.md` (how to switch services on + env vars),
`PROJECT_STATE.md` (engineering state), `AGENTS.md` (product brief). This brief was derived from
a code-grounded, adversarially-verified cost audit on 2026-06-21.*
