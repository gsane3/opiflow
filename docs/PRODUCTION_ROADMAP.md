# Deskop — Production Readiness Roadmap

The things a serious agency builds that a "vibe coder" skips. Grouped by area, prioritized **P0 → P2**. Items marked ✅ were implemented in this pass; the rest are the proposed plan.

---

## 0. Branding
- ✅ Renamed the product to **Deskop** (Desk Operator) everywhere. App = `deskop.ai`, marketing = `deskop.com`.

## 1. Backbone — handle many requests at scale
- **P0 — Distributed rate limiting.** Today's limiters are in‑memory (`Map`) → they reset on every serverless cold start and are per‑instance, so they don't actually protect anything under load. Move to **Upstash Redis** (`@upstash/ratelimit`) keyed by user id + IP. (Abstraction added in `src/lib/rate-limit.ts` — swap the backend to Redis when the account exists.)
- **P0 — Pooled DB connections.** Serverless functions exhaust Postgres connections. Use Supabase's **pooled** connection (PgBouncer, port 6543 / `?pgbouncer=true`) for the service client.
- **P0 — Indexes.** Ensure indexes on every hot filter: `customers(business_id)`, `(business_id, created_at)`, `communications(business_id, customer_id, created_at)`, `tasks(business_id, status, due_date)`, `offers(business_id, status)`, and `token_hash` on every `*_response_tokens` / intake table.
- **P1 — Pagination.** Lists fetch `limit=100`/`5000`. Add cursor pagination (`created_at < cursor`) on customers/offers/tasks/communications before any account has thousands of rows.
- **P1 — Offload heavy work to a queue.** AI brief generation, Viber sends and email should not block the webhook/request. Use **QStash** or Supabase Edge Functions + a `jobs` table with retry/backoff. Makes the call→brief path resilient to provider latency/outages.
- **P1 — Caching.** CDN for the marketing site (static), `Cache-Control` on public token GETs, and client data caching (React Query / SWR) to cut redundant fetches (the AppShell hits `/api/businesses/me` on every navigation today).

## 2. Security
- ✅ **Security headers** (HSTS, X‑Frame‑Options, X‑Content‑Type‑Options, Referrer‑Policy, Permissions‑Policy) via `next.config.ts`.
- ✅ **Shared tenant‑auth helper** (`src/lib/api/auth.ts`) so every route resolves `{ user, businessId }` the same way and can't forget the `business_id` filter.
- **P0 — Row Level Security ON.** The app uses the service‑role key (bypasses RLS). Turn RLS **on** with correct per‑tenant policies anyway, so a leaked anon key (browser) can never read another tenant's data. Defense in depth.
- **P1 — HMAC webhook signatures.** PBX/Apifon use a static shared secret; upgrade to HMAC over the raw body (Telnyx already does Ed25519 — mirror it).
- **P1 — Input validation with `zod`** at every API boundary (replace hand‑rolled `str()`/`num()` guards).
- **P1 — Audit log** (`audit_events`: who/what/when) for sensitive actions (offer sent, customer deleted, number assigned).
- **P1 — Auth hardening:** password reset flow, email‑enumeration‑safe responses, optional 2FA, login rate‑limit by account.
- **P2 — Secret rotation** + `npm audit` / Dependabot in CI.

## 3. Reliability & observability
- **P0 — Error monitoring (Sentry)**, client + server, with PII scrubbing. Right now failures are invisible in production.
- ✅ **Health check** at `/api/health` (for uptime monitors / load balancers).
- **P1 — Structured logging** with request ids; never log tokens/PII.
- **P1 — Uptime + alerting** (BetterStack/Pingdom) on `/api/health` and the webhooks.
- **P0 — Backups**: Supabase Pro daily backups + a tested restore.

## 4. Data & GDPR (EU / Greek users — mandatory)
- ✅ **Terms of Service** (`/terms`) and **Privacy Policy** (`/privacy`), linked from registration. *Have a lawyer review before launch.*
- **P0 — Data Subject Rights:** export (✅ customers CSV) **and erasure** — a "delete my account + all data" flow. Required by GDPR.
- **P0 — Subprocessor list + DPAs** (Supabase, Anthropic, OpenAI, Apifon, Resend). Disclose in the privacy policy.
- **P1 — Retention policy** for `communications`/recordings (recordings are already not stored — good; define how long summaries live).
- **P1 — Call‑recording consent** notice (Greek law) before any recording feature ships.

## 5. Testing & CI/CD
- ✅ **CI** (lint + typecheck + build on every PR) — `.github/workflows/ci.yml`.
- **P1 — Unit tests** (Vitest) for pure logic: `phone`, `ics`, `offer-calculations`, `ai/schema`, the CSV import mapper.
- **P2 — E2E** (Playwright) for login → onboarding → call→intake→pairing → offer send.
- **P1 — Preview deploys** per PR (Vercel) + a **staging** project with its own Supabase.

## 6. Design system & UX
- **P1 — Extract a component library** (`Button`, `Card`, `Input`, `Badge`, `Sheet`, `Modal`, `EmptyState`) so 30+ files stop re‑declaring the same Tailwind strings. This is the single biggest maintainability win after the modal dedup.
- **P1 — Refactor the 3,931‑line `customers/[id]` page** and its 4 duplicated Viber‑send modals into one `SendViaViberModal`.
- **P2 — Dark mode**, **i18n** scaffold (Greek now, English later), a11y audit to WCAG AA.

## 7. Features the product will need
- **P0 — Billing (Stripe).** Activation is manual today. Stripe Checkout + customer portal + webhook → `business_subscriptions`.
- **P1 — Team/multi‑seat.** `business_users` exists but tenancy is keyed on `businesses.owner_id`. Add invites + roles and resolve `business_id` via membership.
- **P1 — Native push notifications** (offer/appointment responses) — also the thing that makes the iOS app store‑approvable.
- **P1 — Stats dashboard** on `opportunity_value` (pipeline, win rate, value by month/source).
- **P1 — Global search & filters** across customers/offers/tasks.
- **P2 — Message/offer templates**, lead‑source integrations (Meta/Google forms), CSV mapping UI improvements.

---

## Implemented in this pass (summary)
Branding → Deskop · security headers · shared tenant‑auth helper · `/api/health` · `/terms` + `/privacy` (linked from register) · `robots.ts` + `sitemap.ts` · CI workflow · env validation (`src/lib/env.ts`) · rate‑limit abstraction (`src/lib/rate-limit.ts`).

## Recommended next 5 (in order)
1. Stripe billing (unblocks revenue).
2. Sentry + Supabase RLS on (observability + defense in depth).
3. Upstash rate limiting + DB indexes (scale).
4. Component library + customer‑workspace refactor (maintainability).
5. GDPR erasure flow + native push.
