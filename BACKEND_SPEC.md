# yorgos.ai Backend Spec

## Status

- Current production app flow: localStorage MVP. No database-backed CRM data in the main app. No server-side auth in AppShell or app pages.
- Backend foundation: partially implemented and isolated from the MVP app. Standalone backend test surfaces exist and have been manually verified.
- Main AppShell: not backend-aware. All routing still uses localStorage userProfile.
- Do not claim backend is connected to the main app. Standalone test pages only.
- This document defines the target v2 backend direction and is the handoff reference for backend implementation.
- Private beta v1 target includes Voice with automatic AI call brief and Viber intake link delivery. SMS is fallback/v1.1, not the primary v1 messaging channel. See [VOICE_SMS_ARCHITECTURE.md](./VOICE_SMS_ARCHITECTURE.md) for the detailed architecture and Viber intake flow reference.
- Voice pipeline and Viber intake link delivery are not implemented. Blocked by: CRM backend schema (Phase 3), provider selection, webhook infrastructure, transcription jobs, AI brief jobs, Viber provider approval, and legal/consent gate.

### Implemented backend foundation (manually verified)

- Supabase package installed (`@supabase/supabase-js`)
- Supabase browser helper (`createBrowserSupabaseClient`)
- Supabase server helper (`createServerSupabaseClient`, service role, server-only)
- Initial schema migration: `supabase/migrations/001_initial.sql` (businesses + business_users + RLS)
- Data API grants migration: `supabase/migrations/002_grants.sql`
- `GET /api/businesses/me` -- reads authenticated user's business via bearer token
- `POST /api/businesses` -- creates business + business_users row via bearer token
- `/register` -- standalone Supabase Auth sign up page
- `/login/backend` -- standalone Supabase Auth sign in page + logout
- `/auth/confirm` -- standalone email confirmation callback (verifyOtp + exchangeCodeForSession)
- `/onboarding/backend` -- standalone session test: POST /api/businesses
- `/business/backend` -- standalone session test: GET /api/businesses/me
- `/backend` -- standalone developer hub linking all backend test pages
- Logout implemented on all session-bearing standalone backend pages

### Still standalone / not integrated

- AppShell is still localStorage-only. Zero Supabase imports.
- MVP `/login` remains mock (name + email, no password, no Supabase)
- MVP `/onboarding` remains localStorage-only
- Customers, tasks, and offers remain localStorage-only
- No backend data migration from browser storage yet
- No main app backend routing yet (AppShell integration blocked -- see AppShell Readiness Gate section)
- No password reset flow yet

---

## Recommended Stack

- **Supabase** (Postgres + Auth + Storage + Edge Functions)
- **Next.js API routes** for business logic and provider webhooks
- **Resend** for transactional email (already partially integrated)
- **Deployment target TBD** for Next.js hosting. Choose after backend foundation and pilot requirements are clear.

---

## Why This Path

- Fastest path to first real user: Supabase Auth + Postgres are ready-to-use.
- Postgres is the right database for relational CRM data (customers, tasks, offers, communications).
- Row Level Security (RLS) enforces multi-tenant data isolation at the database level, not just in application code.
- Keeps the existing Next.js app structure. No new server framework.
- Postgres schema is portable. Not locked to Supabase-specific data format.
- Better fit than Firebase for relational CRM (Firebase Firestore is document-based, relational joins are expensive).
- Less overhead than a custom Node backend at this product stage.
- Pilot-friendly cost profile. Verify pricing before production.

---

## Current MVP Architecture

### Data storage
- All CRM data is stored in a single localStorage key: `yorgos_ai_mvp_state`
- Data is browser-local. Lost on browser clear or device change.
- No server-side database, no auth, no team sharing.

### Existing real API routes
| Route | Purpose | Requires |
|-------|---------|---------|
| `POST /api/ai/review` | AI brief extraction via Anthropic | `ANTHROPIC_API_KEY` |
| `POST /api/ai/cmd` | Natural language CRM commands | `ANTHROPIC_API_KEY` |
| `POST /api/email/send-offer` | Transactional email via Resend | `RESEND_API_KEY`, `EMAIL_FROM` |

### Current reality
- AI works only when `ANTHROPIC_API_KEY` is configured. Falls back to 503 no_api_key.
- Email sending works only when `RESEND_API_KEY` and `EMAIL_FROM` are configured. Falls back to copy-paste draft.
- FROM address is always the configured yorgos.ai sender. User business email or domain is not used as FROM.
- Calls are mock/demo only. `CallRecord.isMock` is hardcoded `true` in the TypeScript type.
- No live lead imports. Only manual entry and CSV upload.
- No auth, no database, no team sharing.

---

## Target Data Model

All tables (except auth system tables) include `business_id` for multi-tenancy.
Tables are introduced in phases. Do not build all at once.

### `businesses` - Phase 1
- Purpose: One row per business account.
- Key fields: `id`, `owner_id` (references auth.users), `name`, `type`, `phone`, `email`, `address`, `vat_number`, `default_vat_rate`, `sending_domain` (future), `sending_from_email` (future), `business_phone_number` (future).
- Constraint: `owner_id` unique (one business per user in Phase 1).
- Index: `owner_id`.

### `business_users` - Phase 1 (owner only), Phase 4 (teams)
- Purpose: Links users to businesses with a role. Enables future team support.
- Key fields: `business_id`, `user_id`, `role` (owner/admin/member), `invited_at`, `accepted_at`.
- Constraint: PRIMARY KEY (`business_id`, `user_id`).
- Phase 1: insert only owner row on business creation. No invitation UI yet.

### `customers` - Phase 3
- Purpose: CRM contacts. Replaces localStorage customers array.
- Key fields: `id`, `business_id`, `crm_number`, `name`, `company_name`, `phone`, `mobile_phone`, `email`, `address`, `source`, `external_lead_id` (future: Meta/Google ID for dedupe), `status`, `opportunity_value`, `needs_summary`, `notes`, `last_contact_at`, `intake_status`.
- Index: `(business_id, phone)`, `(business_id, email)`.
- RLS: users can only see rows where `business_id` matches their business.

### `tasks` - Phase 3
- Purpose: Follow-up tasks, appointments, send-offer reminders. Replaces localStorage tasks array.
- Key fields: `id`, `business_id`, `customer_id`, `offer_id`, `title`, `type`, `status`, `priority`, `due_date`, `due_time`, `note`, `created_from_ai`, `completed_at`.
- Index: `(business_id, customer_id, status)`.

### `offers` - Phase 3
- Purpose: Price proposals sent to customers. Replaces localStorage offers array.
- Key fields: `id`, `business_id`, `customer_id`, `offer_number`, `status`, `offer_date`, `valid_until`, `items` (jsonb), `subtotal`, `vat_rate`, `vat_amount`, `total`, `notes`, `terms`, `acceptance_text`, `created_from_ai`.
- Index: `(business_id, customer_id, status)`.

### `communications` - Phase 3
- Purpose: Outbound/inbound communication log (SMS, call summaries, email records).
- Key fields: `id`, `business_id`, `customer_id`, `channel`, `direction`, `status`, `phone`, `summary`, `created_at`.
- Note: call records will no longer be hardcoded as mock once real calls are implemented (Phase 6).

### `email_send_logs` - Phase 4
- Purpose: Audit log for every email sent via `/api/email/send-offer`.
- Key fields: `id`, `business_id`, `customer_id`, `offer_id`, `from_address`, `reply_to`, `to_address`, `subject`, `status`, `provider_id` (Resend message ID), `sent_at`, `error_message`.
- Index: `(business_id, offer_id)`.
- Note: Enables right-to-erasure audit and retry logic.

### `lead_source_connections` - Phase 5
- Purpose: Stores OAuth tokens and webhook config for lead source integrations.
- Key fields: `id`, `business_id`, `source_type` (meta/google/tiktok/website_form), `access_token_encrypted`, `refresh_token_encrypted`, `page_or_form_id`, `webhook_secret`, `is_active`, `last_synced_at`.
- Security: tokens must be encrypted at rest (server-side encryption key, not stored in Postgres plaintext).
- Phase 5 only. Do not build OAuth flows until provider app reviews are approved.

### `business_phone_numbers` - Phase 6
- Purpose: Tracks provisioned VoIP numbers.
- Key fields: `id`, `business_id`, `number`, `provider`, `provider_sid`, `status`, `forward_to`, `working_hours` (jsonb), `created_at`.
- Phase 6 only. Do not build until consent design and legal review are complete.

---

## Tenancy and Auth Plan

- Supabase Auth manages users (`auth.users`). No custom user table.
- Phase 1: one user = one business. Simple 1:1.
- `business_users` table exists from the beginning, but only the owner row is inserted on signup. No invitation UI yet.
- Phase 4+: team invitations, role-based access (owner/admin/member).
- `/demo` must remain accessible without auth. Do not put the demo behind a login gate.
- AppShell currently checks `localStorage.userProfile`. After Phase 2, this check is replaced by a Supabase session check.
- AppShell redirect: if no session, redirect to `/login` (not `/demo`) for real users. `/demo` stays open.

---

## Row Level Security Pattern

Every business-owned table follows this pattern:

```sql
-- Enable RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Policy: authenticated user can access rows belonging to their business
CREATE POLICY "business_members_only" ON customers
  USING (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );
```

- Every table with user data has `business_id`.
- RLS enforces isolation at the database level. Application bugs cannot leak cross-business data.
- Service-role key is used only in server-side API routes. Never expose to browser.
- `SUPABASE_SERVICE_ROLE_KEY` stays in server env vars only. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is safe for browser.

---

## LocalStorage Migration Plan

Migration is explicit and user-triggered. Never automatic.

### Flow
1. User logs in to backend account.
2. App detects browser has localStorage data and no migration marker.
3. Settings page shows migration banner: "Τα δεδομένα σου είναι τοπικά. Θέλεις να τα μεταφέρεις στο cloud account σου;"
4. User clicks confirm.
5. App reads localStorage, shows summary: "X πελάτες, Y tasks, Z προσφορές."
6. User confirms transfer.
7. Client sends local JSON to `POST /api/migrate/from-browser`.
8. Server validates all records before inserting. Rejects if validation fails.
9. Server inserts records with old-ID-to-new-ID mapping to preserve relationships.
10. Client stores `migrated_at` timestamp in localStorage to prevent duplicate imports.
11. Subsequent app loads read from backend, not localStorage.

### Safeguards
- Server rejects migration if business already has data (no overwrite).
- Migration endpoint rate-limited: once per hour per business.
- Demo records (`isDemo: true`) are skipped by default. User can opt to include them.
- Partial failures roll back entirely (transaction).
- No automatic migration. Explicit user consent required.

---

## Email Sending Plan

### Phase 1-3 (current behavior)
- Keep existing `POST /api/email/send-offer` Resend route.
- FROM remains the configured yorgos.ai sender address.
- Reply-To can be set to business email if safe (read from `businesses.email`).
- No Gmail, Outlook, SMTP, OAuth, or business-domain sending. Not implemented and not claimed.

### Phase 4
- Add `email_send_logs` table.
- Modify send route to write a log row before and after each send attempt.
- Expose `GET /api/email/send-logs` for the business to see send history.

### Future (Phase 5+)
- `businesses.sending_domain`: user verifies their domain via DNS TXT/CNAME records.
- Once verified, Resend sends FROM `name@verified-domain.com`.
- `businesses.sending_from_email`: the FROM address when domain is verified.
- Do not claim this is implemented until verification flow is complete.

---

## Lead Import Plan

### Phase 5, in order

**Step 1: Generic lead intake endpoint**

```
POST /api/webhooks/lead-intake
Authorization: Bearer <business_api_key>
Body: { name, phone, email, source, notes, external_lead_id }
```

- Creates or updates a Customer row.
- Creates a `call_back` Task linked to the customer.
- Dedupe: normalize phone to E.164, lowercase email. Check existing customers for match before insert.
- Returns `{ ok: true, customer_id, task_id, action: "created" | "updated" }`.

**Step 2: Provider-specific adapters**
- `POST /api/webhooks/meta` -- validates Meta signature, maps fields, calls generic intake.
- `POST /api/webhooks/google` -- same for Google Lead Form.
- `POST /api/webhooks/tiktok` -- same for TikTok Lead Ads.
- `POST /api/webhooks/website-form` -- generic form embed endpoint.

### What not to build first
- OAuth flows for Meta/Google (requires app review from provider. Takes weeks).
- Polling (webhook-only for Phase 5).
- Any paid ad spend data.

---

## Business Phone Plan

Business phone and SMS automatic call-to-CRM is required for private beta v1. It is not implemented yet.

Blocked by: CRM backend schema (Phase 3), provider selection, webhook infrastructure, transcription jobs, AI brief jobs, and legal/consent gate.

**Do not build recording or transcription until consent design and legal review are complete.**

See [VOICE_SMS_ARCHITECTURE.md](./VOICE_SMS_ARCHITECTURE.md) for the full architecture, database model, API plan, AI brief pipeline, Viber intake link delivery plan, and legal/consent gate requirements.

After the AI call brief, if required customer fields are missing, the system creates a secure intake link and delivers it via Viber (planned, not implemented). SMS is fallback/v1.1 for intake link delivery.

### Phase 6 sequence (phone foundation)
1. Define `PhoneProvider` interface (Twilio/Vonage/placeholder implementations).
2. Create `business_phone_numbers` table.
3. Build number provisioning UI in Settings (purchase flow via provider API).
4. Build call routing and forwarding config.
5. Build call log (real calls, not mock).
6. Recording: only after consent flow design and legal review.

### What is in current MVP
- `CallRecord.isMock: true` hardcoded. All calls are mock/demo.
- Native `tel:` links for outbound calls (device dialer only).
- No real VoIP, no recording, no voicemail, no transcription.

### What not to build until legal decisions are made
- Call recording (requires consent notice before call, immutable consent log, GDPR erasure support).
- AI transcription of real calls (separate data retention policy needed).
- Voicemail storage.
- PSTN termination (requires carrier contract).

---

## Privacy and Legal Boundaries

- No hidden recording. Consent must be obtained before any recording begins.
- No GDPR compliance claims before legal review and implementation of right-to-erasure endpoint.
- Raw audio must not be stored by default. Only store recording metadata (duration, consent status) until storage policy is decided.
- Transcripts are not final CRM data by default. They are drafts for user review.
- Right-to-erasure workflow and audit logs are required before commercial production.
- OAuth tokens for lead source connections must be encrypted server-side before storing in database.
- Do not send customer PII in logs or error messages.
- Greece and EU: GDPR applies. A DPA is needed with any sub-processor (AI provider, email provider, SMS provider, phone provider).
- This document does not constitute legal advice. Get legal review before commercial launch.

---

## Phased Roadmap

### Phase 0 -- Backend docs and project setup [COMPLETE]
- Goal: Architecture decisions documented. Supabase project created (manual). Env vars planned.
- Allowed areas: docs, `.env.example`, Supabase project dashboard (not code).
- Validation: This document exists. Supabase project URL and anon key are available.
- Status: Complete. Supabase project created. `.env.local` configured locally. `.env.example` updated.

### Phase 1 -- Supabase client, env setup, initial schema [COMPLETE]
- Goal: Supabase client helpers. `.env.example` updated. First migration SQL for `businesses` and `business_users` tables. Business profile API.
- Allowed areas: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `.env.example`, `supabase/migrations/`, `src/app/api/businesses/`.
- Validation: Supabase client connects. Migrations applied on Supabase dashboard. `GET /api/businesses/me` and `POST /api/businesses` manually verified end-to-end.
- Status: Complete. Browser and server helpers implemented. `001_initial.sql` and `002_grants.sql` applied. Business profile API routes verified with real Supabase project.
- Not yet: Auth UI in main app, customer/task tables, migration tool.

### Phase 2 -- Auth and business account [PARTIALLY COMPLETE -- standalone only]
- Goal: Login, register, onboarding pages. AppShell reads Supabase session. `/demo` stays open.
- Allowed areas: `src/app/login/`, `src/app/register/`, `src/app/onboarding/`, `src/components/layout/AppShell.tsx`.
- Validation: User can register, log in, see their business name. Logout works.
- Status: Standalone backend auth pages exist and are manually verified (`/register`, `/login/backend`, `/auth/confirm`, `/onboarding/backend`, `/business/backend`, `/backend` hub). Logout works on all session-bearing pages. AppShell integration is blocked until the AppShell Readiness Gate (see below) is fully satisfied. MVP `/login` and `/onboarding` remain mock/localStorage.
- Not yet: AppShell backend session awareness. Main app login for backend users. Password reset flow. Customer/task tables, migration tool, email logs.

### Phase 3 -- Database-backed CRM, tasks, offers
- Goal: customers, tasks, offers, communications tables. CRUD via API routes. localStorage becomes secondary.
- Allowed areas: `src/lib/storage.ts` (adapter pattern), `src/app/api/customers/`, `src/app/api/tasks/`, `src/app/api/offers/`.
- Validation: Create a customer, refresh page, customer is still there (from backend, not localStorage).
- Not yet: Lead imports, phone, email logs, teams.

### Phase 4 -- Email logs and migration tool
- Goal: `email_send_logs` table. Migration endpoint. Migration UI in Settings.
- Allowed areas: `src/app/api/email/`, `src/app/api/migrate/`, `src/app/(app)/settings/page.tsx`.
- Validation: Send an email, verify log row exists. Migrate browser data, verify records appear in backend.
- Not yet: Domain verification, team invitations.

### Phase 5 -- Generic lead intake foundation
- Goal: `POST /api/webhooks/lead-intake`. `lead_source_connections` table. Webhook signature validation.
- Allowed areas: `src/app/api/webhooks/`, supabase migrations.
- Validation: POST to endpoint with test payload, customer appears in CRM.
- Not yet: Meta/Google OAuth (provider app review required), TikTok, polling.

### Phase 6 -- Business phone foundation (after legal/provider decisions)
- Goal: `PhoneProvider` abstraction. `business_phone_numbers` table. Number provisioning UI. Call capture. Recording metadata (no audio yet). Webhook infrastructure. Provider event log. Consent events.
- Allowed areas: `src/lib/phone/`, `src/app/api/webhooks/voice/`, `src/app/api/webhooks/sms/`, supabase migrations.
- Validation: Sandbox number provisioned. Inbound call webhook received and stored. Customer matched or created from caller number.
- Not yet: Recording download and storage. Transcription. AI brief. SMS messages.
- Blocked until: Provider selected. Consent announcement reviewed by lawyer.

### Phase 7 -- Voice to CRM pipeline with Viber intake link delivery (v1 track, required for private beta)
- Goal: Full call-to-CRM flow. Recording download. Transcription jobs. AI brief jobs. ai_draft task creation. Customer intake link schema and API. Viber intake link delivery. Customer timeline UI with calls, transcripts, briefs, and intake link status.
- Allowed areas: `src/app/api/jobs/`, `src/app/api/calls/`, `src/app/api/customer-intake-links/`, `src/app/api/viber/`, `src/lib/viber/`, supabase migrations, customer profile UI.
- Validation: Real call ends. Brief appears in CRM within acceptable latency. User can confirm or dismiss brief. ai_draft tasks visible. Intake link created and Viber message sent via manual approval. Customer opens intake form and submits. Customer profile updated.
- Not yet: Outbound SMS (v1.1 fallback). Inbound SMS (v1.1 fallback).
- Blocked until: Phase 6 complete. Transcription provider DPA signed. AI model DPA signed. Viber provider approved and DPA signed. Legal/consent gate complete before production recording or Viber messaging.
- See: [VOICE_SMS_ARCHITECTURE.md](./VOICE_SMS_ARCHITECTURE.md) for database model, API plan, AI brief pipeline, Viber intake delivery, and legal gate details.

---

## AppShell Readiness Gate

Before editing `src/components/layout/AppShell.tsx`, all of the following must be satisfied:

- **Backend/localStorage mode separation**: The app must know which mode a given session is in. If both a Supabase session and a localStorage userProfile exist simultaneously, a defined priority rule must exist.
- **Backend-aware login strategy**: The main `/login` is still mock MVP login (name + email, no password). A backend user must never be redirected there. Either a combined login page or a clear routing rule must exist before AppShell routes backend users.
- **Async session loading state**: AppShell currently redirects synchronously. Adding `getSession()` (async) requires a loading state that holds all redirects until the session check resolves. Without it, a valid backend user may be redirected to `/demo` on first render.
- **Missing Supabase config fallback**: If `createBrowserSupabaseClient()` throws (missing env vars), AppShell must catch it and fall back to localStorage-only behavior. It must not crash or redirect incorrectly.
- **Logout path inside main app**: A logout action must exist in the main app UI (sidebar, settings, or BottomNav) for backend users. Logout from the main app must cleanly reset session state.
- **Token expiry/refresh behavior**: Defined behavior when a session expires mid-use. Options: silent redirect to `/login/backend`, or inline session-expired error. Must not redirect to the mock `/login`.
- **Browser localStorage migration strategy**: A backend-logged-in user entering the main app will see empty data. The localStorage migration flow (Phase 4) must be built, or the empty-state UX must be clearly designed, before AppShell routes backend users into the app.
- **Manual QA**: After AppShell changes, confirm that `/demo` remains public, localStorage MVP users are unaffected, missing Supabase config falls back gracefully, and backend session + localStorage data coexist without conflict.

---

## First Implementation Sequence

1. Add `src/lib/supabase.ts` with anon client and server client helpers.
2. Update `.env.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Create `supabase/migrations/001_initial.sql` with `businesses` and `business_users` tables and RLS.
4. Add `GET /api/businesses/me` route (returns current user's business from Supabase).
5. Add login page at `src/app/login/page.tsx`.
6. Add register/onboarding flow.
7. Update `AppShell` to check Supabase session instead of localStorage `userProfile`.

---

## Open Decisions

These must be resolved before starting Phase 1 implementation:

- **Supabase region**: EU (eu-central-1 Frankfurt recommended for GDPR compliance). Confirm before creating project.
- **Deployment target**: choose after backend foundation and pilot requirements are clear.
- **Email provider final setup**: Resend is integrated. Decide whether to stay on Resend or evaluate alternatives before Phase 4 domain verification.
- **Phone provider**: Twilio vs Vonage vs local Greek carrier. Decide before Phase 6. Do not build until decided.
- **Legal review owner**: Who reviews privacy policy, DPA, GDPR compliance, and recording consent design? Must be assigned before commercial launch.
- **Production privacy policy**: Not yet written. Required before any real user data is collected.
- **Pilot data migration**: Decide whether pilot user browser data should be migrated to the backend, or whether pilot users start fresh on the backend. Both options are valid. Document the decision.

---

*This document was created as part of the yorgos.ai MVP-to-v2 planning process.*
*It is not a product commitment. Verify all third-party pricing and policies before production.*
