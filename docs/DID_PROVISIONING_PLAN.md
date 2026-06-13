# DID Provisioning Plan — per-customer phone numbers (InterTelecom)

> **Status:** the per-customer number model **already exists in code & schema** (built across
> migrations 010–019, 031 + `scripts/provision-asterisk.py`). This doc reconciles that with the
> **confirmed InterTelecom vendor terms** (email 2026-06-13) and defines the **operational
> onboarding flow** so it's ready when customer #1 signs up. The only genuinely missing piece is
> an **outbound caller-ID mode** (`did_cli_mode`) — specced in §5, optional until a customer asks
> to show their own existing number.

---

## 1. TL;DR

- You do **not** need to build `business.did` — it already exists as `businesses.business_phone_number`,
  backed by a full pool/assignment model (`managed_phone_numbers` → `business_phone_numbers`).
- A new customer **auto-gets a number on signup** via the `assign_available_phone_number()` RPC,
  **provided there is an available number in the pool**. The only manual step is **keeping the pool
  stocked** (buy a DID from InterTelecom, ask them to attach it to the trunk, add it to the pool).
- The PBX side (SIP endpoint + inbound dialplan + per-DID caller-ID) is **auto-generated every minute**
  by `scripts/provision-asterisk.py` running on the Asterisk box — no manual Asterisk editing per customer.
- **One real gap** vs the InterTelecom options: showing the **customer's own existing number** as the
  outbound caller-ID (InterTelecom allows it after the customer signs the «Αίτηση Εξουσιοδότησης
  εμφάνισης αριθμών»). Today outbound CLI is always the assigned Opiflow DID. See §5.

---

## 2. Confirmed InterTelecom vendor terms (email 2026-06-13)

| Topic | Answer |
|---|---|
| Pricing | Geographic numbers only, **€15/year per number** (annual subscription, ~€1.25/mo). No big upfront bulk. |
| Delivery | Active ~instantly on purchase; then **email IT** to place it on a trunk. |
| Mobile (69x) | **No** — geographic only. |
| Trunk / routing | One trunk (**IT658318**) holds many DIDs; inbound INVITE carries the called DID → per-customer routing. ✅ |
| Outbound caller-ID | Trunk can present **any number on it**, no extra verification. ✅ |
| Show customer's **own** number | Possible, but the **end customer must sign the «Αίτηση Εξουσιοδότησης εμφάνισης αριθμών»**. |
| Release | No early return / quarantine — you keep the number until the annual sub lapses. |
| Legal / API | Numbers sit on **Opiflow's** account → registered to **Opiflow's** details. **No API** for buy/activate/release (manual via email). EETT obligations (112, registry, portability) **left unanswered** — open item. |

→ Recorded in memory: `intertelecom-did-terms`.

---

## 3. What already exists (the mental-model mapping)

| Your term | Real implementation | Where |
|---|---|---|
| `business.did` | `businesses.business_phone_number` (denormalized active E.164 DID) + the richer `business_phone_numbers` (assignment, 1:1) + `managed_phone_numbers` (the pool) | migrations 010/013/014 |
| pool of numbers | `managed_phone_numbers` — admin-imported numbers; `status` = available/assigned/reserved/cooling_down/retired; `city`, `number_type` (platform_owned / customer_ported) | 010, 013 |
| assign on signup | `assign_available_phone_number(business_id, city)` RPC — atomic `FOR UPDATE SKIP LOCKED`, city-preference, writes `business_phone_numbers` + caches `businesses.business_phone_number` + logs history | 010/014/019 |
| release | `release_business_phone_number(business_id, reason)` — platform_owned → 18-month cooldown; customer_ported → immediate | 015 |
| pending request | `phone_number_requests` (pending/resolved) + admin `PATCH /api/admin/phone-pool action=assign_pending_request` | 019, `src/app/api/admin/phone-pool/route.ts` |
| per-customer SIP line | `browser_sip_endpoints` — `sip_username = biz_<id>`, `sip_password_enc` (AES-256-GCM, `SIP_CRED_ENC_KEY`); minted by the provisioner | 011, 031, `src/lib/server/sip-credentials.ts` |
| inbound DID → business | webhook looks up `business_phone_numbers.e164_number` by the called number (fallback `PBX_BUSINESS_ID`) | `src/app/api/webhooks/voice/pbx/route.ts:245` |
| outbound caller-ID | reads **only** `businesses.business_phone_number` → Twilio `<Dial callerId>` → PAI/RPID to InterTelecom | `src/app/api/webhooks/voice/twilio/outbound/route.ts:181` |
| `did_cli_mode` (which number to show outbound) | **DOES NOT EXIST YET** — see §5. (`businesses.telephony_mode` = native/forward is about **inbound** routing, not outbound CLI.) |

The PBX glue: `scripts/provision-asterisk.py` runs on `root@46.224.138.115` via cron. For every business
with a DID it (1) ensures the `browser_sip_endpoints` row, (2) mints the encrypted SIP password,
(3) regenerates `pjsip_opiflow_users.conf` (per-business WebRTC endpoint) + `extensions_opiflow.conf`
(`exten => <DID> → Set(OPIFLOW_EP=biz_<id>) → from-intertelecom`), setting `OPIFLOW_DID=<30…>` for the
per-DID asserted identity, and reloads only on change. Idempotent.

---

## 4. Onboarding flow for customer #1 (operational, ready now)

**A. Keep the pool stocked (manual, ~5 min/number, do in small batches):**
1. Buy a geographic DID from InterTelecom (€15/yr), preferring the customer's city range
   (Αθήνα 210, Θεσσαλονίκη 2310, Καστοριά 24670, …).
2. Email InterTelecom: «Παρακαλώ τοποθετήστε τον αριθμό **<DID>** στο trunk **IT658318**.»
3. Add it to the pool: `POST /api/admin/phone-pool` `{ e164Number: "+30…", provider: "intertelecom", city: "Αθήνα" }`
   → inserts a `managed_phone_numbers` row with `status='available'`, `number_type='platform_owned'`.

**B. Customer signs up (automatic):**
4. On business creation the server calls `assign_available_phone_number(business_id, city)` → picks the
   oldest available number (city-matched first), marks it `assigned`, writes `business_phone_numbers`,
   caches `businesses.business_phone_number`. If the pool is empty, a `phone_number_requests` row is
   created (pending) — resolve it with `PATCH /api/admin/phone-pool action=assign_pending_request`
   once you've stocked a number.
5. Within ≤1 min the cron `provision-asterisk.py` mints the SIP password + regenerates the Asterisk
   includes → the line is live (inbound rings the app/browser; outbound shows the DID).
6. The customer sees their number in **Ρυθμίσεις → Τηλεφωνία** (read-only, «ενεργοποιείται αυτόματα»).

**C. Verify (once):** place a test outbound call (shows the DID) and ring the DID from a real phone
(rings the app). The `/api/health` + `/api/phone/browser-token` gates confirm activation.

**D. Churn:** `release_business_phone_number(business_id, 'cancelled')`. For InterTelecom numbers you can
also just **stop renewing** at the annual date — IT lets the number lapse (no real quarantine needed;
see §6). The 18-month cooldown in the schema is our generic guard, not an IT requirement.

---

## 5. The one addition: outbound caller-ID mode (`did_cli_mode`)

**Why:** InterTelecom lets a business show **its own existing number** as the outbound CLI (after the
customer signs the «Αίτηση Εξουσιοδότησης εμφάνισης αριθμών»). Today the outbound webhook hard-codes the
Opiflow DID, so this isn't selectable. This is the only schema change needed to support that option.

**Schema (new migration, ~6 lines):**
```sql
ALTER TABLE businesses
  ADD COLUMN outbound_cli_mode  text NOT NULL DEFAULT 'opiflow_did'
    CHECK (outbound_cli_mode IN ('opiflow_did','own_number')),
  ADD COLUMN outbound_cli_number    text,   -- the customer's own E.164 number to display
  ADD COLUMN outbound_cli_authorized boolean NOT NULL DEFAULT false; -- IT authorization form on file
```
(Reuse `forwarding_source_number` instead of `outbound_cli_number` if you prefer one field for "the
customer's own number" — but a distinct column keeps inbound-forward and outbound-CLI concerns separate.)

**Code (one place):** `src/app/api/webhooks/voice/twilio/outbound/route.ts:181-189` — replace the single
`business_phone_number` read with:
```ts
// select business_phone_number, outbound_cli_mode, outbound_cli_number, outbound_cli_authorized
const useOwn = biz.outbound_cli_mode === 'own_number'
  && biz.outbound_cli_authorized === true
  && !!biz.outbound_cli_number?.trim();
const did = (useOwn ? biz.outbound_cli_number : biz.business_phone_number)?.trim();
```
The rest (`callerId = did.replace(/^\+/, '')`, the `<Dial callerId>`) is unchanged. **Guard:** only present
the "own number" option in the UI once `outbound_cli_authorized` is set true by an admin after the signed
form is on file — InterTelecom requires the authorization, and showing an unauthorized number risks the
trunk rejecting the asserted identity.

**Note:** the browser/SIP outbound path (Twilio Voice token → same outbound webhook) flows through the
same route, so this single change covers both the app dialer and any browser calling.

**Effort:** ~1 migration + ~10 lines in one route + a small admin/settings toggle. Defer until a customer
actually asks for it.

---

## 6. InterTelecom-specific deltas vs the generic schema

- **No provider API** → the pool is stocked manually (`POST /api/admin/phone-pool`). The schema's
  `provider_ref` can hold IT's reference if useful. Fine for the first ~10–50 customers; a thin admin UI
  over `/api/admin/phone-pool` + `phone_number_requests` removes the JSON-by-hand step at scale.
- **No real cooldown** → IT says "leave until it expires". The `cooling_down` / `available_after (+18mo)`
  logic is our own safety; for IT geographic numbers you can release immediately and stop renewing, or
  keep the number assigned until the annual sub lapses. Don't over-index on the 18-month value.
- **Geographic only (no 69x)** → set customer expectations: a local landline reads as more
  established/local for a tradesperson anyway.

---

## 7. Open items (not blocking the first customer)

1. **EETT / legal** — numbers are registered to Opiflow, so this is "a phone line provided **as a
   service**", not "selling a number". State that in the ToS. Get a clear answer from IT (and ideally a
   lawyer) on 112 / subscriber-registry / portability responsibility **before onboarding many customers**.
2. **Admin UI** for the pool / pending requests / assignment history (today: raw `/api/admin/phone-pool`
   JSON). Low effort, high quality-of-life once you onboard regularly.
3. **Self-serve city preference** at signup (the `phone_number_requests.requested_city` field exists but
   isn't surfaced in onboarding).
4. **`did_cli_mode`** (§5) — implement when a customer wants their own number shown.

---

_Last updated: 2026-06-13 (session 18). Grounded against migrations 010–019/031,
`scripts/provision-asterisk.py`, `src/app/api/webhooks/voice/{pbx,twilio/outbound}/route.ts`,
`src/app/api/admin/phone-pool/route.ts`, `src/lib/server/sip-credentials.ts`._
