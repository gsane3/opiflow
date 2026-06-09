# Opiflow — Phone-first Messenger Redesign · Build Plan

> Canonical engineering plan for the full UX/UI redesign (session 12, 2026-06-09).
> Design blueprint + locked decisions live in the chat; this is the grounded,
> codebase-verified build plan. Migrations are applied **manually** in the Supabase
> SQL editor (project `oluhmztfimmgmbxoioea`). Last existing migration = `036` →
> new ones start at `037`. PR → merge to `master`; `next build` must stay green.

## Locked product decisions
- **Nav:** `[Αρχική] [Κλήσεις] [Πελάτες] [Settings]` + AI assistant **floating everywhere**.
- Login/Register/OAuth/Reset/Onboarding + Team/multi-user: **unchanged for now**.
- Στατιστικά → inside **Settings**. Notifications **bell stays on Αρχική**. Global search **cut**.
- Offer doc creation behind **➕ per customer**; customer **info panel shows aggregated offers**.
- Public customer pages stay (refresh later). **WhatsApp removed.**
- Recording **auto-on + spoken consent**. Waterfall: mobile → Viber (→auto SMS), landline → Email.
- **Missed call → automatic** waterfall · **answered call → ask** post-call.
- Calendar = **day view + swipe**. AI: from Αρχική = general (disambiguation); from card = customer-scoped.
- Catalog = **all import methods, team-shared**. Customer statuses simplified → **Νέος / Σε εξέλιξη / Κερδισμένος / Χαμένος**.

## 0. Strategy — two independent tracks
- **Track A (UI/UX redesign):** build **NOW** on existing web/jsSIP + PBX, with graceful "pending" states where the native engine is missing.
- **Track B (Calling/recording engine):** native inbound + native recording + auto waterfall + STT — separate sequence with its own blockers (Twilio SIP Domain, Push Credential, Apifon approval).

**Data-model principle:** do **not** overload `communications` (already 1:1 with `viber_messages`/Apifon). **Derive** the unified chat-timeline via a server endpoint; add new tables only where storage is genuinely missing (catalog, suggested-action chips, appointment duration, briefs).

---

## 1. Data model deltas (migrations 037+, manual in SQL editor)

### 1.1 `037_appointment_duration.sql` — appointment duration + calendar
Appointments are `public.tasks` rows with `type IN ('book_appointment','visit_customer')`. Today only `due_date date` + `due_time text (HH:MM)` — no start/end.
```sql
ALTER TABLE public.tasks
  ADD COLUMN start_at timestamptz,
  ADD COLUMN end_at   timestamptz;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_end_after_start CHECK (end_at IS NULL OR end_at > start_at);
UPDATE public.tasks
   SET start_at = (due_date::text || ' ' || COALESCE(due_time,'09:00'))::timestamptz
 WHERE type IN ('book_appointment','visit_customer') AND start_at IS NULL;
CREATE INDEX tasks_business_start_appt_idx
  ON public.tasks (business_id, start_at)
  WHERE type IN ('book_appointment','visit_customer');
```
Mirror on `appointment_response_tokens`: `ADD COLUMN requested_start_at timestamptz, requested_end_at timestamptz` (keep `due_date`/`due_time` for back-compat).

### 1.2 Unified per-customer chat-timeline — DERIVE (recommended, no new table)
New endpoint `GET /api/customers/[id]/timeline` merges server-side: `communications` (calls + outbound viber/sms/email) + `offers`+`offer_response_tokens` + `tasks(book_appointment)`+`appointment_response_tokens` + `customer_intake_tokens` + `customer_upload_sessions` + `customer.notes`. Output: `{ type, side:'us'|'customer', interactive, refTable, refId, summary, occurredAt, payload }`. Realtime via Supabase subscription on `communications` + refetch for token tables. Same aggregation pattern as the existing `/api/notifications`. **No `customer_events` table in MVP.**

### 1.3 `038_call_briefs.sql` — brief timeline (append, stop overwrite)
Today one brief per call in `communications.summary`, and `/api/calls/recording` **overwrites** it (metadata → transcript). History is lost.
```sql
CREATE TABLE public.call_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  communication_id uuid REFERENCES communications(id) ON DELETE CASCADE,
  brief_kind text NOT NULL CHECK (brief_kind IN ('metadata','transcript')),
  brief_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_briefs_business_customer_idx ON public.call_briefs (business_id, customer_id, created_at DESC);
ALTER TABLE public.customers
  ADD COLUMN journey_summary text,
  ADD COLUMN journey_updated_at timestamptz;
```
RLS via `business_users`. `metadata` + `transcript` briefs co-exist (append). `customers.journey_summary` = AI-synthesized cross-call narrative, written **only after user confirmation** (review-first, same rule as `/api/ai/customer-memory`).

### 1.4 `039_status_simplify.sql` — customer status 7→4
```sql
UPDATE public.customers SET status='in_progress'
 WHERE status IN ('contacted','follow_up_needed','offer_drafted','offer_sent');
UPDATE public.customers SET status='new' WHERE status='new_lead';
ALTER TABLE public.customers DROP CONSTRAINT customers_status_check;
ALTER TABLE public.customers
  ADD CONSTRAINT customers_status_check CHECK (status IN ('new','in_progress','won','lost'));
ALTER TABLE public.customers ALTER COLUMN status SET DEFAULT 'new';
```
**Lockstep code edits:** `src/lib/types.ts` `CustomerStatus`, `STATUS_LABELS`/`ui-labels.ts`, `CustomerStatusBadge`, `customers/page.tsx` filters, and every status writer: `/api/offers/[id]/notify`, `/api/customers/[id]/appointment-link`, `/api/webhooks/voice/pbx`, `/api/customers`, `/api/ai/customer-memory`.

### 1.5 `040_service_catalog.sql` — service catalog (NEW, team-shared)
No catalog exists today (confirmed grep 001–036). `offer_items.description` is free-text.
```sql
CREATE TABLE public.service_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  description text,
  category text,
  unit text,                      -- τεμ./ώρα/m²
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  vat_rate numeric NOT NULL DEFAULT 24 CHECK (vat_rate >= 0),
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai_chat','file_import')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_catalog_items_business_id_key UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX service_catalog_code_uq ON public.service_catalog_items (business_id, lower(code)) WHERE code IS NOT NULL;
CREATE INDEX service_catalog_list_idx ON public.service_catalog_items (business_id, active, category);
ALTER TABLE public.offer_items
  ADD COLUMN catalog_item_id uuid,
  ADD CONSTRAINT offer_items_catalog_fk
    FOREIGN KEY (business_id, catalog_item_id)
    REFERENCES public.service_catalog_items(business_id, id) ON DELETE SET NULL;
```
RLS = same membership pattern as `007_offers_core.sql`. **Snapshot rule:** copy `name`/`unit_price` into the offer item at creation — catalog price changes don't alter historical offers. Soft-delete via `active=false`.

### 1.6 Aggregated offers per customer — DERIVE (no new table)
`GET /api/customers/[id]/offers/summary` → `{ offer_count, total_value, accepted_count, pending_count, latest_status, latest_offer_date }`. `opportunity_value` stays on `customers`.

### 1.7 `041_suggested_actions.sql` — AI suggested-action chips (light new table)
```sql
CREATE TABLE public.suggested_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source_communication_id uuid REFERENCES communications(id) ON DELETE SET NULL,
  action_type text NOT NULL,      -- send_offer | book_appointment | call_back | request_photos | request_details | reminder
  label text NOT NULL,
  params jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suggested_actions_open_idx ON public.suggested_actions (business_id, customer_id, status, created_at DESC);
```
The single new append-only realtime point feeding the in-chat AI chips. Seed from `CustomerSummaryFromCalls.tsx` + `deriveTask()` heuristic.

### 1.8 Secondary (lower priority)
- `042_preferred_channel.sql` — migrate `'whatsapp'`→`'viber'`, tighten CHECK to `('viber','sms','email','phone')`; drop WhatsApp helpers.
- `043_customer_media.sql` — unify gallery: new `customer_media` table; move business-side media off device-local IndexedDB (`src/lib/customer-files.ts`) into `customer-uploads` bucket → team-shared.
- `044` — `notification_reads(user_id, business_id, last_seen_at)` for real bell unread state.
- Logo editable: whitelist `logo_url` in `/api/businesses/me` PATCH, or new `business-logos` bucket.
- **DB types:** add typegen (`supabase gen types typescript` → `src/types/database.ts`) to replace stale localStorage shapes in `src/lib/types.ts`.

---

## 2. API deltas

**KEEP:** `/api/communications`, `/api/customers`(+`[id]`), `/api/offers`(+items/notify/response-link/offer-response), `/api/email/send-offer`, `/api/customers/[id]/files/*`, `/api/upload/[token]/*`, `/api/intake/[token]`, `/api/phone/{browser-token,twilio-token,presence}`, `/api/webhooks/*`, `/api/billing/*`, `/api/notifications`, `/api/push/*`, `/api/team/*`, `/api/account/delete`. `send-channel.ts` Viber→SMS dispatcher unchanged.

**MODIFY:**
- `/api/tasks` — support `start_at`/`end_at`; message builders render start–end.
- `/api/ai/cmd` (`cmd-schema.ts`/`cmd-prompt.ts`) — add intents `send_offer`(+`catalogItemIds`), `book_appointment`(date+startTime+duration), `send_reminder`, `request_photos`, `request_details`; accept optional `customerId` (scoped) + candidate list for name→id + `disambiguation:[{id,name}]`. Stays review-first.
- `/api/ai/review` — pass business catalog so parsed line items snap to catalog services+codes+prices.
- Status writers → 4-status model (§1.4).

**NEW:**
- `GET /api/customers/[id]/timeline` — unified chat stream (§1.2) + `recordingStatus`/`inboundEngine` pending flags.
- `GET /api/customers/[id]/offers/summary` (§1.6).
- `GET /api/catalog`, `POST/PATCH/DELETE /api/catalog/[id]`, `GET /api/catalog/search?q=`.
- `POST /api/ai/catalog-import` — paste text or uploaded file → reviewed array → bulk insert after confirm (review-first).
- `GET /api/home/agenda?from=&to=` — day-grouped appointments w/ start/end.
- `GET /api/home/callbacks` — open `tasks WHERE type='call_back'` → `{customerId, name, phone, reason, dueDate}`.
- `GET /api/suggested-actions?customerId=` + `PATCH /api/suggested-actions/[id]`.
- (Track B) `POST /api/ai/transcribe`, `POST /api/calls/[communicationId]/post-call-action`, `api/webhooks/voice/twilio/inbound`, telephony settings persistence.

---

## 3. Component plan

**REUSE as-is (design-system primitives — standardize):** `src/components/ui/*` — Button, Card (`rounded-[28px]` canonical surface), Badge, BottomSheet+SheetRow, Input/Textarea/EmptyState/Spinner/cn. Plus `FileGallery.tsx`, `CustomerSummaryFromCalls.tsx`. Keep indigo-mapped emerald accent.

**REUSE w/ minor changes:** `BrowserPhone.tsx` (force `recordingEnabled=true` + auto-connect), extract `NumpadPanel` from `calls/page.tsx` (~1127), `AttentionInboxBar.tsx` (home bell), `CustomerCard.tsx` (4-status), `OfferForm/OfferPreview` (+catalog auto-suggest), settings panels re-slotted.

**UNIFY — `SendViaViberModal` → `SendChannelSheet` (critical):** `SendChannelSheet.tsx` is the base; retire `SendViaViberModal` overlay, keep its `executeViberSend` orchestrator; port 4 review flows; strip WhatsApp branch + `'whatsapp'` from `PreferredContactMethod`.

**NEW:**
1. **MessengerCustomerView** (replaces stacked-card `customers/[id]/page.tsx`; reuse data/handlers, retire hero+8 CollapsibleSections JSX): `ChatHeader`, `ChatBubble`, `CallBubble`, `InteractiveBubble`, `AiNextActionChips`, `ChatComposer` (➕ menu), bottom-left customer-scoped 🎙️.
2. **CustomerInfoPanel** (right-sliding): `BriefTimeline`, contact info, `FileGallery`, `AggregatedOffers`, internal note, Maps, reject.
3. **CalendarDayPopup** + **CallbackListPopup** (home chips, BottomSheet).
4. **AiAssistantPopup** — Siri-like floating overlay (general + scoped); reuse `src/lib/speech.ts` + `/api/ai/cmd`; absorbs `/cmd` page.
5. **ServiceCatalogPanel** + import flows.

**RETIRE:** BottomNav "Βοηθός" slot + "Περισσότερα" modal; DesktopSidebar flat list; nav exposure of `/tasks /appointments /offers /stats /search /cmd`; Κλήσεις recording/connect/mic toggles; Πελάτες stats strip; `renderProviders()` placeholder.

---

## 4. Two tracks

### Track A — UI/UX (buildable NOW)
- **A1.** Nav → 4 slots + AI floating popup. Retire "Περισσότερα"/flat sidebar.
- **A2.** Αρχική: keep greeting + bell + hero; new chips → CalendarDayPopup (`/api/home/agenda`) + CallbackListPopup (`/api/home/callbacks`).
- **A3.** Κλήσεις shell: remove inline toggles (auto-on), extract NumpadPanel.
- **A4.** Πελάτες: drop stats strip, keep search + filter chips + CustomerCard.
- **A5.** Messenger card: MessengerCustomerView + CustomerInfoPanel (`/api/customers/[id]/timeline`); CallBubble pending state; interactive inbound bubbles.
- **A6.** Settings 6 categories.
- **A7.** Catalog: ServiceCatalogPanel + 3 import paths + OfferForm auto-suggest.
- **A8.** AI: AiAssistantPopup (general + scoped) + AiNextActionChips.
- **A9.** Calendar/callback popups.

### Track B — Calling/recording engine
- **B1. (small, unblocks briefs now)** stamp `twilio_sid=<CallSid>` on the `communications` row at call-log time — without it Twilio recordings never match and briefs silently drop. **Blocker: none.**
- **B2. Native inbound:** Twilio SIP Domain; new `api/webhooks/voice/twilio/inbound` → `<Dial><Client>biz_<id>`; extend `provision-asterisk.py`; wire `twilio-voice.ts` onIncoming/accept into BrowserPhone behind `Capacitor.isNativePlatform()`. **Blocker: iOS PushKit gap** (needs Twilio Push Credential APNs VoIP `.p8` + FCM).
- **B3. Native recording (server-side):** standardize `record='record-from-answer-dual'` + `recordingStatusCallback` on both TwiML endpoints; retire web `CallRecorder` for native; brief reuse via `transcribeAndBriefCallAudio()`.
- **B4. GDPR spoken consent:** `<Say language='el-GR'>η κλήση καταγράφεται</Say>` before `<Dial record>`; thread `consent_announced=true`.
- **B5. Auto missed-call waterfall:** in `webhooks/voice/pbx` (+ future Twilio no-answer), on `NOANSWER/BUSY/CANCEL/FAILED/CONGESTION` → auto intake token + `sendViaPreferredChannel` (mobile) / `sendCustomerLinkEmail` (landline). Per-business gated. Keep operator-confirm for ANSWERED.
- **B6. STT assistant:** `POST /api/ai/transcribe` (Deepgram→OpenAI Greek STT) + native mic plugin + scoped cmd + surname disambiguation. **Blocker: per-minute STT cost.**

---

## 5. Dependency-ordered phases

| Phase | Goal | Deliverables | Deps | Size |
|---|---|---|---|---|
| **P0 — Data foundation** | Schema ready | 037 (duration), 039 (status 7→4 + code lockstep), 040 (catalog + FK), 041 (suggested_actions), 042 (preferred_channel), typegen `src/types/database.ts` | none | M |
| **P1 — Quick engine unblock** | Briefs stop dropping | B1 (`twilio_sid=`), 038 (call_briefs + journey_summary, stop overwrite) | none (∥ P0) | S |
| **P2 — Shell & nav** | Phone-first skeleton | A1 nav→4 + AI FAB shell, A3 Κλήσεις auto-on + NumpadPanel, A4 Πελάτες no-stats, A6 Settings 6-cat scaffold, UNIFY SendChannelSheet (strip WhatsApp) | P0 (status badges) | M |
| **P3 — Messenger core** | Card becomes chat | `/timeline`, MessengerCustomerView + CustomerInfoPanel + bubbles, `/offers/summary`, BriefTimeline, interactive inbound bubbles | P0,P1,P2 | L |
| **P4 — Catalog + offers + home popups** | Catalog & agenda | `/api/catalog`+CRUD+search, `/api/ai/catalog-import`, ServiceCatalogPanel, OfferForm auto-suggest, `/api/home/agenda`+`callbacks`, CalendarDayPopup + CallbackListPopup | P0,P2 | M/L |
| **P5 — AI assistant + chips** | Voice + scoped actions | AiAssistantPopup, expanded `/api/ai/cmd` + disambiguation, `/api/ai/transcribe`, AiNextActionChips | P0,P3,P4 | M |
| **P6 — Native engine** | Closed-app inbound + server recording + auto-waterfall | B2 inbound TwiML+SIP Domain+provisioner, Push Credential, B3 server recording, B4 consent, B5 waterfall, telephony settings, device validation | P1,P2 · external blockers | L |

**Critical path:** P0 → P2 → P3 (Messenger is the heart). P1 runs in parallel. P6 (native) is independent + gated by external blockers — does **not** block Track A; UI uses pending states until P6 lands.

---

## 6. Risks & legal flags
- **GDPR auto-recording:** must ship spoken consent (B4) before any `<Dial record>` on native. Current web banner is passive/insufficient. Don't ship auto-record without the prompt.
- **STT per-minute cost:** auto-record × every call multiplies Deepgram/OpenAI cost. Gate per-business; consider on-device STT (`@capacitor-community/speech-recognition`) for the assistant.
- **Apifon Viber-sender approval pending:** sends are safe no-ops until approved; Viber bubbles won't deliver (SMS fallback works). Show pending delivery status.
- **iOS inbound / PushKit gap:** Capgo plugin sends no iOS push; closed-app ring needs Twilio Push Credential (APNs VoIP `.p8`, Team `7Q7A3NFK8T`, FCM). Hard blocker for B2 on iOS; Android less affected.
- **Native recording not wired:** today web/jsSIP-only + broken in iOS WKWebView. Until B3, CallBubble must render pending, not assume a recording exists.
- **Engine-vs-UI mismatch:** "auto-on telephony" assumes an always-registered native engine that doesn't exist yet — mandatory explicit "engine pending / not-ready" states in the redesign.
- **Twilio recording silent-drop (existing bug):** without B1 (`twilio_sid=`), Twilio recordings never match → briefs dropped. Fix early (P1).
