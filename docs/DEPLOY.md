# Deploy & go-live (deskop)

The web app is a standard **Next.js server app** (App Router + API routes), so it
deploys to **Vercel** with zero config. The native Android/iOS shells just load
the deployed URL (`capacitor.config.json → server.url`). This guide takes you from
repo → a live URL you can test on your phone.

> **Fastest test:** deploy the web app, open the URL on your phone, install the PWA.
> Auth + CRM + UI work with just the Supabase keys. Calls/recording additionally
> need your telephony (SIP) server live — see group D below.

---

## 1. Supabase (database + auth)

1. In your Supabase project, run every migration in `supabase/migrations/*.sql`
   in order (SQL Editor, or `supabase db push` with the CLI). Includes the
   session-4 ones: `027_performance_indexes`, `028_rls_policies`,
   `029_audit_events`, `030_jobs`.
2. Project Settings → API → copy the **Project URL**, **anon key**, **service_role key**.
3. Authentication → URL Configuration → add your deployment URL(s) to
   **Redirect URLs** (needed for Google/Apple OAuth, email confirm, password reset):
   `https://<your-vercel-url>/auth/callback`, `/auth/confirm`, `/auth/reset`.

## 2. Vercel

1. Import the GitHub repo `gsane3/yorgos`. Vercel auto-detects Next.js (build
   `next build`, no overrides needed).
2. To test before merging, deploy the branch `launch-readiness-and-mvp-features`
   as a **Preview**; or merge PR #1 to `master` and deploy production.
3. Add the env vars below (Settings → Environment Variables).
4. Deploy → you get a `https://<project>.vercel.app` URL.
5. Set **`NEXT_PUBLIC_APP_URL`** to that URL (or your custom domain) and redeploy,
   so customer links (intake/offer/appointment/upload) point to the right host.
   *(If unset, the app falls back to `VERCEL_URL` automatically — fine for a first test.)*

## 3. Environment variables

**A. Required to boot** (Supabase):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

**B. Recommended:**
`NEXT_PUBLIC_APP_URL` (your domain — correct customer links),
`ADMIN_USER_ID` (your Supabase user id — unlocks `/backend` admin tools)

**C. AI:** `ANTHROPIC_API_KEY` (briefs/cmd/review), `OPENAI_API_KEY` (recording
transcription); optional `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_BRIEF_MODEL`

**D. In-app calls (jsSIP)** — needs a SIP-over-WSS gateway:
`PHONE_SIP_WSS_URL`, `PHONE_SIP_USERNAME`, `PHONE_SIP_PASSWORD`, `PHONE_SIP_REALM`

**E. Inbound PBX webhooks:** `PBX_WEBHOOK_SECRET`, `PBX_BUSINESS_ID`
(leave `ALLOW_INSECURE_WEBHOOKS` UNSET in prod — webhooks fail-closed)

**F. Viber (Apifon):** `APIFON_API_KEY`, `APIFON_CLIENT_ID`, `APIFON_SENDER_ID`,
`APIFON_VIBER_SENDER_ID`, `APIFON_BASE_URL`, `APIFON_WEBHOOK_SECRET`

**G. Email (Resend):** `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`

**H. Billing (Stripe):** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`

**I. Rate limiting (Upstash):** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
(else an in-memory per-instance limiter is used)

**J. Observability:** `SENTRY_DSN` (optional)

**K. Native deep links:** `APPLE_APP_ID` (`<TeamID>.ai.deskop.app`),
`ANDROID_SHA256_CERT_FINGERPRINTS`, optional `ANDROID_PACKAGE_NAME`

*Auto-set by Vercel — do not add:* `VERCEL_URL`, `NODE_ENV`.

## 4. Webhooks (after you have the URL)

Point your providers at the deployed URL, using the secrets above:
- PBX JSON: `POST https://<url>/api/webhooks/voice/pbx` (header `x-pbx-webhook-secret`)
- PBX recording: `POST https://<url>/api/webhooks/voice/pbx-recording`
- Apifon status: `POST https://<url>/api/webhooks/apifon/status` (header `x-apifon-webhook-secret`)
- Stripe: `POST https://<url>/api/webhooks/stripe` (set `STRIPE_WEBHOOK_SECRET` from the Stripe dashboard)

## 5. Phone smoke test (what to verify)

With just **group A** set:
- [ ] `/register` → email confirm → `/package` → `/onboarding` → `/dashboard`
- [ ] Create a customer; it appears in the list; open the workspace
- [ ] Install the PWA (Add to Home Screen) — icon + splash show
- [ ] `/stats`, `/search`, `/settings → Λογαριασμός` load

With **C** added: AI brief on a saved call / `/cmd` dictation.
With **D + your SIP server**: make/answer a call in the app; enable the recording
toggle (announce to the customer) and confirm the transcript brief appears.

## 6. CI (optional)

Copy `docs/ci-workflow.yml` to `.github/workflows/ci.yml` to run lint + build on
every push. (It lives in `docs/` because the OAuth token used here lacks the
`workflow` scope to push under `.github/workflows/`.)

## 7. Native apps

See `docs/NATIVE_WRAPPER.md`. The Android project is scaffolded in `android/`;
build the signed `.aab` in Android Studio, add iOS on a Mac. The shells load
`server.url`, so once the web app is live and `server.url` points to it, the
native apps show the same live app.
