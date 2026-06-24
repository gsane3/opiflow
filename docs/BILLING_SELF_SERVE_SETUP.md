# Self-serve billing — owner activation checklist

The code for pay-at-signup self-serve subscriptions is shipped and **safe/no-op
until you complete the steps below**. Until then, signups fall back to the old
behaviour (entitled immediately, manual billing) so nothing breaks.

**Plan:** one plan — **29,95€ + ΦΠΑ (37,14€ incl. VAT) / month**, billed monthly,
pay immediately at signup. Single source of truth: `src/lib/billing/plans.ts`.

## 1. Apply migration 061 (Supabase SQL editor, live project `oluhmztfimmgmbxoioea`)

Run `supabase/migrations/061_self_serve_billing.sql`. It:
- adds `pending_payment` + `past_due` to the `business_subscriptions` status CHECK,
- adds `stripe_customer_id` / `stripe_subscription_id` columns.

After this, **new public signups become `pending_payment`** (must pay to use the
phone). Existing `pending_manual_review` / `trialing` accounts are untouched and
stay active.

## 2. Stripe Dashboard

1. Create a **Product** "Opiflow" with a **recurring monthly Price** of **€37.14**
   (i.e. 29.95 + 24% VAT — Stripe charges the gross amount; decide whether to mark
   it tax-inclusive or add Stripe Tax). Copy the Price id (`price_…`).
2. Create a **webhook endpoint** → `https://<your-domain>/api/webhooks/stripe`,
   subscribed to at least: `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy the signing secret (`whsec_…`).
3. Enable the **Customer Billing Portal** (Settings → Billing → Customer portal)
   so the in-app "manage subscription" works.

## 3. Vercel env vars (`sane127/opiflow`)

| Var | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` |
| `STRIPE_PRICE_ID` | the `price_…` from step 2.1 |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` from step 2.2 |

Redeploy. `/api/health` will then show `integrations.billing: true`.

## 4. Verify

- Sign up a fresh test account → after onboarding the number screen shows
  **«Πληρωμή & ενεργοποίηση»** → Stripe Checkout → pay (use a test card in test
  mode) → returns to the app → the webhook flips the subscription to `active` →
  the number/phone unlocks.
- A failed/cancelled checkout leaves the account `pending_payment` (no telephony)
  until they pay.

## Notes / follow-ups (not blocking)

- **Dunning:** `invoice.payment_failed` is currently logged only. A later pass can
  set `past_due` + notify on renewal failure (the column + status now exist).
- **VAT/invoicing:** confirm whether you issue Greek invoices via Stripe Tax /
  Stripe Invoicing or your accountant; the ToS states prices ex-VAT + 24% ΦΠΑ.
- Existing manually-onboarded users stay entitled; migrate them to real Stripe
  subscriptions at your own pace (or leave them as `pending_manual_review`).
