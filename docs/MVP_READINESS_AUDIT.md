# Opiflow — MVP Market-Readiness Audit

**Date:** 2026-06-24 · **Method:** 11-dimension multi-agent audit (each auditor read the real
codebase) + adversarial verification of every critical/high finding. 6 dimensions completed with
full agency-grade depth (security, API/data, public surface, features, reliability, market); 5 hit
the account session limit mid-run (web-ux, web-ui, native, code-health, a11y/i18n) and were
filled with a targeted inline pass — those 5 are flagged **[partial]** below and warrant a full
follow-up pass.

> Severities below are the **verifier-adjusted** values. The adversarial pass **refuted 2 findings
> outright** and **down-graded several** — see "Refuted / corrected" at the bottom. Trust the
> numbers here, not any single auditor's first pass.

---

## Verdict

**Pilot-ready, not cold-public-ready.** The engineering core is genuinely strong — multi-tenant
isolation, public-token security, webhook signatures, and the data layer are all above typical
pre-launch quality. What stands between you and a confident public launch is **~1 week of mostly
copy/config + a handful of small code fixes**, concentrated in three places: **(1) money** (pricing
is told three incompatible ways and the ToS plan names don't exist in the UI), **(2) trust signals**
(fake app-store badges, generic link previews), and **(3) production blindness** (no error
monitoring wired, health check can't see an outage).

## End-to-end test — baseline: **GREEN**

| Check | Result |
|---|---|
| Web typecheck (`tsc --noEmit`) | ✅ pass |
| Web unit tests (vitest) | ✅ 291/291 (28 files) |
| Web production build (`next build`) | ✅ pass |
| Native typecheck (`tsc --noEmit`) | ✅ pass |
| Repo hygiene | ✅ 12 stray 0-byte junk files removed; `console.log` in web app/components = 0 |

---

## P0 — Launch blockers (fix before public go-live)

| # | Finding | Where | Sev | Effort |
|---|---|---|---|---|
| P0-1 | **Pricing told 3 incompatible ways** — landing: no price; `/package`: €29 / €59 "Starter/Pro/Team"; `/terms` (binding): €24.95 / €39.95 +VAT "Βασικό / Με Τηλεφωνία". Stripe charges a 4th opaque `STRIPE_PRICE_ID`. The plan a user agrees to in the ToS literally doesn't exist in the purchase UI. | `page.tsx`, `package/page.tsx:17`, `terms/page.tsx:44` | high | M |
| P0-2 | **Monetization decision** — every signup = `pending_manual_review` = full access, no payment enforced anywhere; Stripe checkout exists but is disconnected from onboarding (Settings-only, config-gated). This is an *intentional* manual-billing posture (documented) — the blocker is making the product honest about it. Tie with P0-1. | `businesses/route.ts:239-250` | high | M (copy) / L (wire Stripe) |
| P0-3 | **Fake app-store badges** — official Google Play + App Store badges under "Κατέβασέ το στο κινητό σου" both link to `/register`. Deceptive UX + Apple/Google trademark-guideline risk. | `marketing/StoreBadges.tsx:5-6`, `page.tsx:140` | medium | S |
| P0-4 | **Production is blind** — `SENTRY_DSN` unset, `captureException` imported by 0 files, `error.tsx` only `console.error`s, and there is **no `global-error.tsx`** (root-layout crashes are uncaught + unreported). | `instrumentation*.ts`, `app/error.tsx`, (missing `global-error.tsx`) | medium | M |
| P0-5 | **`/f/` portal crawlable** — `robots.ts` disallows every other token route but omits `/f/` (the most data-rich: totals, line items, address, chat, IBAN). No per-page `noindex` either. | `robots.ts:12-20`, `f/[token]/page.tsx` | medium | S |
| P0-6 | **No role enforcement on owner-only routes** — any invited `member` can delete the whole account, read/write bank IBANs, and open the billing portal. `isManager` exists but is applied only to the 3 team routes. | `account/delete`, `billing/portal`, `businesses/me/bank-accounts`, `lib/api/auth.ts` | high | S |
| P0-7 | **Stripe webhook silently fails to activate paid subs** — blind `UPDATE … .eq(business_id)` with no `.select()`/row-count, wrapped in a swallowing `try/catch`, never persists Stripe ids; a paid customer can end up never activated with zero signal. (Only bites if charging at launch.) | `webhooks/stripe/route.ts:31-42` | high | M |
| P0-8 | **GDPR erasure leaks media + lies on failure** — relational tables DO cascade (verifier correction), but uploaded customer photos/videos in Storage are never purged, `provider_webhook_events` (caller numbers, no business_id) is never deleted, and the core delete is best-effort `try/catch` that still returns `{ ok: true }` on failure. | `account/delete/route.ts:25-55` | medium | M |

## P1 — High-value (strongly recommended pre-launch)

| # | Finding | Where | Sev | Effort |
|---|---|---|---|---|
| P1-1 | **Shared links unfurl as generic "Opiflow"** — no `generateMetadata` on `/f`, `/offer-response`, `/appointment-response`, etc. The whole delivery channel is Viber/SMS link-sharing; previews should show the technician's business name + "Η προσφορά σας". Business name is already loaded server-side. | `f/[token]/page.tsx`, response pages | medium | M |
| P1-2 | **No `metadataBase`** → no OG/Twitter image resolves to absolute; every shared link is an image-less text card. Prereq for P1-1. | `app/layout.tsx` | low | S |
| P1-3 | **Clipboard "Αντιγράφηκε" lies on failure** — IBAN copy `catch {}`s then *always* shows green success; `navigator.clipboard` is undefined in Viber/in-app webviews where customers open the link → they paste nothing into their bank app. | `f/[token]/PortalView.tsx:94-106` | medium | S |
| P1-4 | **Health check can't see an outage** — `/api/health` checks env presence only; returns `ok:true` while Supabase is down, so monitors stay green during an incident. | `health/route.ts:10-25` | medium | S |
| P1-5 | **Crons swallow every error as "table missing"** — any transient/permission/timeout error → `{ ok:true, skipped }`, Vercel sees 200, due reminders/scheduled-messages silently never send. Only treat `42P01/PGRST205` as benign. | `cron/scheduled-messages`, `cron/recordings-reconcile` | medium | S |
| P1-6 | **Expired/invalid links dead-end** — "Επικοινωνήστε με την επιχείρηση" with no phone, name, or action; the business phone is resolvable from the token but unused on the fallback screen. | `f/[token]/page.tsx`, response/upload clients | medium | M |
| P1-7 | **Public rate-limiting fails open + per-instance** without Upstash — effective limit = max × warm-instances, resets on cold start; main control against enumeration/abuse of mint routes. Require Upstash in prod + surface in health. | `lib/rate-limit.ts:61-99` | medium | M |
| P1-8 | **Voucher redemption TOCTOU** — read-modify-write counter; concurrent signups over-redeem a capped voucher (code comment admits it). Use a guarded atomic `UPDATE … WHERE current < max RETURNING`. | `businesses/route.ts:254-266` | medium | S |
| P1-9 | **Signup subscription insert unchecked** — if it fails, the business exists with no sub row → can never be activated (compounds P0-7). Capture+check the error. | `businesses/route.ts:245` | low | S |

## P2 — Correctness & polish

| # | Finding | Where | Effort |
|---|---|---|---|
| P2-1 | List endpoints return page-size as `count` (clients can't detect "more"); use PostgREST `{ count: 'planned' }`. | `customers/`, `offers/`, `communications/` routes | S |
| P2-2 | PBX webhook dedups call rows via `LIKE '%uniqueid=…%'` on free-text summary (unindexed, brittle); stamp `provider_call_id` and dedup on it. | `webhooks/voice/pbx/route.ts:341-372` | M |
| P2-3 | Enum drift: customer create allows `viber/email/phone`, update adds `sms` → create/update reach different states. Hoist shared validation lib. | `customers/route.ts:31` vs `[id]/route.ts:28` | S |
| P2-4 | Inbound phone-match `.or()` across 3 phone columns is unindexed → seq-scan on the call hot-path; add indexes. | `pbx/route.ts:110`, mig 027 | S |
| P2-5 | `calls/log` writes `status='missed'` with no degrade fallback (its PBX sibling has one) — only bites on a DB without mig 043 (prob. applied). | `calls/log/route.ts:156` | S |
| P2-6 | Apifon webhook has no HMAC (only optional shared secret); implement documented signature, fail closed in prod. | `webhooks/apifon/status` | M |
| P2-7 | Webhooks default unauthenticated in non-prod and rely on one global `ALLOW_INSECURE_WEBHOOKS`; confirm it's unset in prod + scope per-endpoint + surface in health. | pbx/twilio/apifon webhooks | S |
| P2-8 | `/api/health` discloses integration topology + missing-env names (recon); split public liveness vs admin-gated readiness. | `health/route.ts` | S |
| P2-9 | `disclosure-audio` stores unvalidated base64 → decoded into ffmpeg on the PBX host; sniff/validate real audio + mime allowlist. | `disclosure-audio/route.ts` | S |
| P2-10 | Twilio recording downloader sends credentials to a webhook-supplied URL with no `.twilio.com` host allowlist (SSRF defense-in-depth; mitigated today by signature check). | `lib/server/twilio-recording.ts:60` | S |
| P2-11 | Backend `/backend/*` pages gated client-side only (API *is* server-enforced); add a lint/middleware so a future backend page can't leak. | `RequireAdmin.tsx` | S |
| P2-12 | **Public-surface polish cluster:** offer/appointment-response have no print/PDF + show customer email/home-address with no purpose on a forwardable link; `greetingName` fetched but never rendered; upload "expired" vs "completed" show identical copy; portal chat is single-line `<input>` that drops a half-typed draft on backdrop-tap; printed offer PDF has no footer/page numbers. | various `f/`, `offer-response/`, `upload/` | S–M each |
| P2-13 | Stripe webhook handles only `checkout.completed` + `subscription.deleted` (no dunning/`past_due`/renewal) — only if charging at launch. | `webhooks/stripe/route.ts` | M |
| P2-14 | Migration **049 is genuinely missing** (jumps 048→050) and unverified in prod; add a lightweight applied-migrations ledger + drift check. | `supabase/migrations/` | S |

## P3 — Code health / simplification (post-launch unless noted)

| # | Item | Note |
|---|---|---|
| P3-1 | **Dual mobile strategy — DECISION NEEDED (not a deletion).** `native/` (Expo + Twilio RN SDK) is the live, actively-shipped app. The root **Capacitor** wrap (`android/`, `capacitor.config.json` → loads the website; no `ios/`) + your in-session CPaaS-on-Capacitor research = a possible *future* track. Keeping both knowingly is fine; the cost is root deps (`jssip`, `@capgo/capacitor-twilio-voice`, `@capacitor/*`, `firebase`) + an `android/` tree that confuse the repo. **Owner must pick: commit to Expo / migrate to Capacitor / keep both intentionally.** I will not delete either without your call. |
| P3-2 | **Heavy files** (safe sub-component extraction only, no behavior change): `calls/page.tsx` (2168L), `cmd/page.tsx` (1919L), `OfferPreview.tsx` (1335L), `appointments/page.tsx` (1281L), native `settings.tsx` (1115L). Optional, post-launch. |
| P3-3 | Remove the leftover `🛈 diag` line in `DisclosureRecorder.tsx` (carried from the s35 debugging). |
| P3-4 | **Good news:** web `console.log` = 0; web `ProjectProcess` is used (web/native split, not duplication); junk files already cleaned. No obvious dead web code found in the partial pass. |

---

## Refuted / corrected by the adversarial pass (do NOT action)

- ❌ **"Wrong legal entity (flood-defense company)"** — *Αντιπλημμυρικά Ελλάδος ΙΚΕ* is the **real, deliberately-chosen** registered operator (ΑΦΜ 803311450, ΓΕΜΗ 194339601000), per PR #299. Common Greek practice to launch under an existing IKE. Not a defect.
- ❌ **"No instant value — number is manual at signup"** — `assignPhoneNumber()` **auto-assigns at signup** when the pool has stock; manual path is only the empty-pool fallback. Real (medium) issue is **pool inventory ops** (InterTelecom has no provisioning API → keep the pool stocked), not a code flaw.
- ⚠️ **"No self-serve billing despite free CTA"** down-graded critical→low — the "free" promise is actually **honored** (no paywall gate anywhere); it's a monetization-strategy gap (covered by P0-1/P0-2), not a user-facing breakage.
- ⚠️ **GDPR "orphaned across ~12 tables"** down-graded — relational children **DO** cascade from `businesses`; only Storage media + the global webhook log are the real gaps (now P0-8).

## Coverage matrix

| Dimension | Depth |
|---|---|
| 🔒 Security & auth | ✅ full (10 findings, verified) |
| 🧩 API correctness & data model | ✅ full (12 findings, verified) |
| 🌐 Public customer-facing surface | ✅ full (11 findings, verified) |
| 📈 Market-readiness | ✅ full (5 findings, verified) |
| ✅ Features & gaps | ⚠️ thin (1 finding) — supplemented by market + security |
| 🛠️ Reliability & ops | ⚠️ thin (3 findings) — supplemented inline (error boundaries, crons) |
| 🧭 Web UX & usability | ⛔ **[partial]** — needs full pass |
| 🎨 Web visual / UI craft | ⛔ **[partial]** — design tokens confirmed coherent; needs full craft pass |
| 📱 Native app UX | ⛔ **[partial]** — dual-mobile resolved; needs full screen-by-screen pass |
| ♿ Accessibility & i18n | ⛔ **[partial]** — needs full pass |

The 4 **[partial]** dimensions hit the session limit (resets 10pm Athens) and deserve a second
deep pass — they are the most likely source of additional *polish* findings (not blockers; the
blockers cluster in money/trust/observability, which got full coverage).
