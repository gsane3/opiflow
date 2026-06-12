# Opiflow — Launch checklist (go LIVE & start selling)

Status as of session 17 (all Quo features F1–F9 + the session-16 review fixes are
merged to `master`). This is the gap between "code complete" and "live + selling".

Legend: ✅ done in code · 🟡 owner action (no code) · 🔴 blocks going live.

---

## 1. Database & environment (do FIRST — a few minutes)

🔴 **Apply migrations in the Supabase SQL editor** (project `oluhmztfimmgmbxoioea`),
in order, if not already applied:
- `043_review_fixes.sql` (missed status, atomic counters, indexes)
- `044_quo_features.sql` (snippets, scheduled_messages, business hours/auto-reply,
  pinned). All new features degrade gracefully without it, but need it to fully work.

🔴 **Set Vercel env vars** (Production + Preview):
- `CRON_SECRET` — REQUIRED for all crons (intake-reminder, scheduled-messages,
  recordings-reconcile, weekly-summary). Without it they 503 in production.
- `RESEND_API_KEY` + `EMAIL_FROM` — email delivery of intake/upload/offer links
  (health currently `email:false`).
- `SENTRY_DSN` — error monitoring (currently `monitoring:false`; built, just blind).

🟡 Optional telephony tuning envs (safe defaults exist): `OUTBOUND_ALLOWED_DEST_REGEX`,
`OUTBOUND_DAILY_CALL_CAP`, `TWILIO_DIAL_TIME_LIMIT_SECONDS`, `PHONE_SIP_SHARED_OK`.

🔴 **Per-user SIP provisioning before a 2nd paying tenant** — run
`scripts/provision-asterisk.py` for each business so each gets its OWN SIP
credential (the shared Mode B credential must not be handed to multiple tenants).

---

## 2. iOS — App Store

✅ App builds + runs (EAS preview, build #12 verified path). Branded icon/splash.
✅ `aps-environment: production`, Greek mic permission, VoIP background mode.
🟡 App Store Connect: create the app record (bundle `ai.opiflow.app`), fill the
   listing from `docs/STORE_LISTING.md`, upload screenshots.
🟡 Build a **production** binary: `cd native && eas build -p ios --profile production`
   then `eas submit -p ios` (Apple API key is cached in EAS).
🟡 Apple App Privacy questionnaire (see STORE_LISTING → Data safety).
🔴 Submit for review (Apple review ~1–3 days).

---

## 3. Android — Play Store

✅ **APK building now** (EAS preview, `eas build -p android --profile preview`) —
   for sideload/testing. Works for outbound calls + full CRM.
🔴 **Inbound calls on Android need Firebase + a Twilio Android push credential**
   (owner): create a Firebase project, add `google-services.json`, create a Twilio
   Push Credential (FCM) → set `TWILIO_PUSH_CREDENTIAL_SID_ANDROID` in Vercel. The
   client already sends `platform=android` (R5). Until then Android = outbound + CRM
   only (inbound rings iOS only).
🟡 Play Console account ($25 one-time), create the app, Data safety form.
🟡 Build a **production AAB**: `eas build -p android --profile production`, upload
   (first upload manual; then `eas submit -p android` with a service-account JSON).
🔴 Submit for review (Play review ~1–7 days; new accounts may need closed testing first).

---

## 4. Monetization — "start selling" (the real blocker for revenue)

🔴 **Stripe checkout is NOT wired** (task B4 #59 pending; health `billing:false`).
   To charge customers you need ONE of:
   - **Stripe** (recommended for web/self-serve): owner creates a Stripe account +
     a Price; set `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` + webhook secret; then
     wire `/api/billing/checkout` (code is scaffolded). ~1 day of work + owner setup.
   - **Manual billing** to start: onboard the first paying customers by hand
     (subscriptions are already `pending_manual_review`); invoice off-platform.
     Fastest path to first revenue while Stripe is finished.
   - ⚠️ In-app purchases: if you sell the subscription INSIDE the iOS/Android app,
     Apple/Google require their IAP (15–30%). Selling via the website (Stripe) and
     letting users just log in to the app avoids that — recommended.

---

## 5. Legal / trust (before public sale)

🟡 Review `/privacy` + `/terms` (they exist but are short — have them checked,
   especially the **call-recording notice** required in Greece/EU).
✅ Account deletion endpoint exists (`/api/account/delete`).
🟡 Confirm the Twilio call-recording consent announcement is in the inbound flow.

---

## 6. What already works today (sell these)

Native iOS app: launch, login, outbound + inbound calls (CallKit), every call →
Greek AI brief with «Επόμενα βήματα», missed-call task + push + after-hours
auto-reply, Messenger customer timeline, free-text messaging + snippets + AI reply
suggestions, scheduled messages, appointments, offers (VAT), intake/photo links,
pinned customers, weekly summary, contact import. Web app at https://www.opiflow.ai
with the same CRM + settings.

## Suggested go-live order
1. Migrations 043/044 + Vercel envs (CRON_SECRET/RESEND/SENTRY) — today.
2. Decide monetization: start with **manual billing** to get first customers now;
   finish Stripe in parallel.
3. iOS production build → App Store submit.
4. Firebase + Twilio-Android → Android production AAB → Play submit.
5. First customers onboarded manually while the stores are in review.
