# Έργο Stage 4 — Portal v2 implementation plan (token bridge)

> Grounded by a read-only mapping of the existing offer/appointment response flows.
> Stage 4a (DONE): Stepper on the public `/f/[token]` page (uses `view.step`).
> Stage 4b (NEXT): inline offer-accept + appointment-respond via a **shared lib**
> (NOT a parallel path) + portal UI. Stage 4c: Q&A thread display. Payment card =
> payments wave (Stage 8), not here. **Security-review the final diff before merge.**

## Key finding
There is **no shared `acceptOffer()`/`respondAppointment()` today** — the mutation
logic is inlined in the two public POST routes:
- `src/app/api/offer-response/[token]/route.ts` — POST ~lines 351–601
- `src/app/api/appointment-response/[token]/route.ts` — POST ~lines 384–689
The `*-response-tokens.ts` libs only do token lifecycle (`findValid…`/`markOpened`/`markResponded`).

## 1. Extract shared libs (preserve byte-for-byte behavior; refactor existing routes to call them)
**`src/lib/server/offer-accept.ts` → `applyOfferResponse({ supabase, businessId, offer, response:'accepted'|'rejected', comment, sentChannel, tokenId?, workFolderId? })`**
Guards (re-checked INSIDE the fn = idempotency boundary): `FINAL_STATUSES=['accepted','rejected','expired']` → 409 `offer_already_final`; `valid_until && isBeforeToday(valid_until)` → 409 `offer_expired`.
Side effects in order: (1) offers.status update + `buildNoteAppend` notes + updated_at [FATAL, scoped `.eq(id).eq(business_id)`]; (2) customers.status → won/rejected→lost [best-effort]; (3) on accepted, insert follow-up `tasks` row (call_back/open/high/today) [best-effort]; (4) `communications` inbound/completed row (`buildCommunicationSummary`, `resolveChannel(sentChannel)`) [FATAL] — **also stamp `work_folder_id` when called from the folder route**; (5) `markOfferResponseTokenResponded` [FATAL but **skip when `tokenId` undefined** — folder flow has no offer-response token]; (6) owner push [best-effort].

**`src/lib/server/appointment-respond.ts` → `applyAppointmentResponse({ ..., task, response:'accepted'|'declined'|'time_change_requested', comment, requestedDueDate?, requestedDueTime?, sentChannel, tokenId?, workFolderId? })`**
Guards: type ∈ `APPOINTMENT_TYPES=['book_appointment','visit_customer']` else 404; `FINAL_TASK_STATUSES=['completed','cancelled']` → 409; `due_date && isBeforeToday` → 409; for `time_change_requested` require due_date+due_time and the proposed slot must be **exactly ±60 min** from current (parseTaskDateTime/formatDateUTC/formatTimeUTC, allowed = base−1h/base+1h) else 400.
Side effects: (1) task **note** append only — **status is deliberately NOT changed** [FATAL]; (2) `communications` inbound/completed row [FATAL, stamp work_folder_id from folder route]; (3) `markAppointmentResponseTokenResponded` [skip when tokenId undefined]; (4) owner push [best-effort].
Co-locate the pure helpers (`buildNoteAppend`, `buildCommunicationSummary`, `resolveChannel`, `computeCanRespond`, `isBeforeToday`, the ±60 date math) in these libs; existing routes import them. Extend the existing `__tests__` for both.

## 2. New folder-scoped endpoints (model on `src/app/api/f/[token]/message/route.ts`)
- `POST /api/f/[token]/offer/[offerId]/accept`  (body `{response:'accepted'|'rejected', comment?}`)
- `POST /api/f/[token]/appointment/[taskId]/respond`  (body `{response, comment?, requestedDueDate?, requestedDueTime?}`)
Order of checks: (1) `makePublicLimiter(10,60_000)`; (2) content-type json else 415; (3) parse+validate body (response in set; comment trim≤1000; date `^\d{4}-\d{2}-\d{2}$`, time `^([01]\d|2[0-3]):[0-5]\d$`); (4) `findValidFolderToken(token)` → null ⇒ 404 fail-closed; (5) `createServiceSupabaseClient()`; (6) resolve `work_folders` by `.eq('id',tok.work_folder_id).eq('business_id',tok.business_id)`; (7) **IDOR-critical** fetch offer/task by **all three** `.eq('id',pathId).eq('business_id',tok.business_id).eq('work_folder_id',tok.work_folder_id).maybeSingle()` (task also assert type ∈ APPOINTMENT_TYPES) → no row ⇒ 404 (no oracle); (8) call the shared fn with `tokenId: undefined`, `workFolderId: tok.work_folder_id`; (9) return the same small shape the token routes return.
Exposing the offer/task UUID in the path is SAFE: the folder token is the sole credential; the row is fetched scoped to token-derived `(business_id, work_folder_id)`; a wrong id ⇒ generic 404.

## 3. `public-folder.ts` additions (single chokepoint = `toPublicFolderView`; update its test)
- Offers select (line ~190) → add `id, valid_until`; `PublicFolderOffer` gains `id` + `canAccept` (= `!FINAL_STATUSES.includes(status) && !(valid_until && isBeforeToday(valid_until))` — reuse the offer-accept lib's helper so the gate can't drift).
- Tasks select (line ~197) → add `id, status`; `PublicFolderAppointment` gains `id` + `canRespond` (type∈APPOINTMENT_TYPES, status∉final, has due_date, not before today) + current slot for the ±60 UI.
- Expose ONLY the UUID + booleans + customer-facing label. NEVER business_id/customer_id/folder id/notes/terms/acceptance_text/raw pipeline status.

## 4. Q&A thread reader (Stage 4c) — safe ONLY with the channel filter
`communications.summary` is overloaded: **`channel='call'` rows hold internal AI briefs** — must never reach the portal. Reader filters ALL of: `business_id=tok.business_id`, `work_folder_id=tok.work_folder_id`, **`channel IN ('sms','viber','email')` (i.e. `<> 'call'`)**, `status='completed'`; select only `direction, summary, created_at`. NEVER touch `call_briefs` / `customers.journey_summary` / offers.notes / work_folders.notes.

## 5. Portal UI (page is a server component; actions need small client islands)
- Offer card: if `canAccept`, render **«Αποδοχή»** + **«Έχω απορία»** (the latter reuses the existing QuestionForm flow); POST to the new offer endpoint; on success show «Αποδεκτή».
- Appointment card: if `canRespond`, **«Επιβεβαίωση»** + **«Αλλαγή ώρας»** (±60-min options); POST to the appointment endpoint.
- Q&A thread: render prior `direction in/out` bubbles above the existing send box.
- Multi-project switcher: DEFER (needs the customer's other folders' tokens — design separately).

## Security pitfalls (from the mapping)
Cross-folder/business IDOR (mandatory triple-scope), replay after FINAL (re-check inside shared fn), expiry bypass (offer valid_until / task due_date independent of token expiry), token-table confusion (tokenId undefined in folder flow), fail-closed generic errors (no enumeration oracle), never expose internal notes/briefs, stamp work_folder_id from token-derived folder only.
