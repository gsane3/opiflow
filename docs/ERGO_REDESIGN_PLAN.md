# Έργο redesign — build plan (canonical)

> Source of truth for porting the **Opiflow redesign prototype** into the production
> web + native + backend. Prototype lives at `E:\yorgos\Opiflow project feature\Opiflow App`
> (single-file React-in-browser iOS prototype; analyze it, do NOT ship it). This doc is the
> faithful spec + staged plan. Read it before any "Έργο/redesign" stage. Update it as stages land.

**Created:** 2026-06-16 (session 19). **Decisions locked by the owner** (see §Decisions).

---

## 0. The one load-bearing fact

**The prototype's "project / Έργο" IS the existing `work_folders` row ("Φάκελος εργασίας"), evolved.**
There is NO new core entity. The per-project link, per-project portal, and per-project timeline
are exactly `work_folders` + `customer_folder_tokens` + `work_folder_id`-scoped
offers/tasks/communications/intake/upload tokens shipped in **migration 046**. The redesign is
**additive**: one column (`work_folders.step`), bank columns on `businesses`, one new table
(`payment_requests`), and surfacing/assembly on three surfaces. Everywhere the prototype says
"project / έργο" → the production entity is the work folder, **renamed in copy to «Έργο»**.

## Decisions (owner, locked 2026-06-16)
1. **Web-first.** Build Process (stepper) + Portal v2 on web first (that is where #239 + the public
   `/f/[token]` live), then native parity. The customer portal is inherently web, so it gates native regardless.
2. **#239 merged to master** (HEAD `088c124`, "Merge pull request #239"). All new web builds on its
   components (`CustomerFoldersStrip`, `FolderDetailPanel`, `MessengerTimeline`).
3. **Payments are a separate, later wave** (Stages 7/9 + their schema 048). Money/legal risk → built
   and reviewed on its own. Process + Portal-v2 (minus the payment card) ship first.
4. **Rename "Φάκελος εργασίας" → «Έργο»** in all UI copy (web + native). Copy-only; entity unchanged.

## Non-negotiable: the money boundary
The app **never moves money.** It DISPLAYS the business's own IBAN for a manual bank transfer; the
customer self-reports via **«Δήλωσα την κατάθεση»**; the owner **confirms** manually. Schema + UI
keep **`declared` (customer self-report) and `confirmed` (owner-authoritative) strictly separate** —
only owner-confirm is authoritative, and no copy implies funds arrived before confirm. Amounts/pct
are **computed + validated server-side from the offer gross** (mirror `calculateOfferTotals`); never
trust client values. The %-slider is on **gross (incl. ΦΠΑ)**.
⚠️ Prototype bug to NOT reproduce: `PortalPayment` hardcodes 30/70 and the technician sheet defaults
balance to 100 — the portal must render the **actual pct/amount stored on the `payment_request`**, not re-derive.

---

## 1. Feature inventory (exists | partial | NEW)

### Login — `web: exists` / `native: exists`
Email/password + Google/Apple + /register + /forgot-password already ship. Prototype's **phone-OTP**
(the prototype's *default* tab) + OTP 6-box + 30s resend = **NEW / deferred** (Decision: defer; not core).

### Home — `web: exists` (richer) / `native: exists` (richer)
Greeting, stat cards, Σήμερα, Να πάρω τηλέφωνο, activity, notifications sheet, global AISheet (center
FAB → `/cmd`) all ship and exceed the prototype. Only the stats-sheet **6-month offer-value bars +
customers-by-status legend + pipeline aggregates** are `partial` (verify exact aggregates). Low priority.

### Customers — list `exists`, profile `web: partial` / `native: exists`
- **Customer status = 4 values** `new | progress | won | lost` (filter bar Όλοι/Νέοι/Σε εξέλιξη/
  Κερδισμένοι/Χαμένοι) — maps to existing `customers.status` pipeline. **Project status = 3 values**
  `new | progress | done` — maps to folder `open|in_progress|done` (`archived` hidden). These are
  **two independent axes** (customer lifecycle vs project status); do not conflate. The 5-step
  `step` is a **third, orthogonal** axis (granular progress within a project).
- Profile: hero + 4 quick-actions + AI brief (summary + **tags**) + projects list w/ mini-stepper +
  contact + internal note. Native already has this (richer); web folds profile into `CustomerInfoPanel`
  (no dedicated profile screen, no mini-stepper). Brief **`tags`** have no backend column → decide
  (drop, or add to `call_briefs`).
- **The prototype is already folder-optional**: empty state shows the locked-chip nudge AND a
  "ή χωρίς project" escape hatch + non-gated «Αίτημα στοιχείων». This AGREES with #239 — reproduce
  **both** the nudge and the escape hatch; there is no gating conflict to resolve.

### Projects / Process (technician) — timeline `partial`, stepper `NEW`
- Chat timeline events: `sys | brief | msg | offer | accepted | pay | appt | req`. `MessengerTimeline`
  (web) + native chat cover call/sms/viber/email/offer/offer_response/appointment/appointment_response/
  intake/upload — but **customer-scoped, not folder-scoped**, and **no `pay` event**. The prototype
  `msg` channel `'Link'` = the **portal/in-app thread** (a 4th conceptual channel, distinct from
  sms/viber/email); `req` (kind photos|info, files N) = folder-scoped upload/intake tokens (046's
  nullable `work_folder_id` must actually be populated by this flow — wiring task).
- **Stepper** (STEPS Επαφή/Προσφορά/Πληρωμή/Ραντεβού/Τέλος) with 3 states (done/now/todo), driven by
  **`work_folders.step` (0..4)** — `NEW` on every surface. ⚠️ **Model decision:** prototype advances
  step partly from events (offer present → 1, accept → 2, paid → 3) AND via the ⋯ menu. Production:
  `step` is the **authoritative stored value**; events (offer create / accept / payment confirm) may
  **auto-advance** it server-side, and the ⋯ menu Παράλειψη/Ολοκλήρωση PATCHes it. Pin identical on
  web + native + portal.
- Header **project-switcher pill** (dot+title+customer+status) + switch sheet — `partial` (web has the
  `CustomerFoldersStrip`; needs the single header pill). **eye → «Προβολή ως πελάτη» portal preview** —
  web `partial` (public page exists), native `NEW`.
- **⋯ menu**: Παράλειψη βήματος / Ολοκλήρωση έργου / Αίτημα πληρωμής / Απόρριψη πελάτη (reject → polite
  decline + mark **«Χαμένο»/lost**). Skip/complete = `step` PATCH; payment = payments wave.
- Dock 4 quick actions (Στοιχεία/Φωτό/Ραντεβού/Προσφορά) + composer (AI suggest + message) — `exists`.
- **PaymentRequestSheet opens from THREE places**: the inline AcceptedCard «Αίτημα πληρωμής» CTA, the
  ⋯ menu, and the menu re-route. (payments wave.)

### Portal v2 (customer link `/f/[token]`) — `partial → big assembly`
Today read-only summary (business hero + title + status + offers + appointments + question send).
Add: **Stepper**; inline offer **Αποδοχή / «Έχω απορία»**; **payment card** (payments wave);
appointment **Επιβεβαίωση / Αλλαγή ώρας**; **Q&A thread display** (currently send-only);
**upload-from-portal**; **multi-project switcher**.
⚠️ **Token bridge:** three token systems (`customer_folder_tokens`, `offer_response_tokens`,
`appointment_response_tokens`). Inline accept/appointment actions MUST reuse the existing
response-token semantics (status guards, `valid_until`, `FINAL_STATUSES`) via a **shared lib** —
never a parallel accept path to the same offer. Each new public POST gets its own rate limit + 409/expiry.

### Payments — `NEW` (entire domain; separate wave)
Bank fields on `businesses` (beneficiary/bank/IBAN, editable in Settings); `payment_requests` table;
PaymentRequestSheet (deposit|balance + %-slider on gross); portal PortalPayment card (BankRows +
CopyBtn + «Δήλωσα την κατάθεση»); owner-confirm; `pay` timeline event. Grep confirms 0 precedent.

### Branded Offer PDF (OfferDoc) — `web: partial` / `native: partial`
`OfferPreview.tsx` has logo/identity/line-items/totals/terms + `window.print()` A4, **missing bank/IBAN
block + deposit terms**. Native `offer-preview-sheet.tsx` is a summary, no PDF export. Reachable from
BOTH the technician offer card AND the portal "Προβολή ολόκληρης προσφοράς (PDF)". Document is
theme-independent (fixed print-light) but brand-tinted. **Recommendation: client print-to-PDF first**
(matches existing approach); server PDF only if a stored/emailed file is required.

### Dialer / Settings — dialer `native: exists` / web `partial`; settings `exists` except bank `NEW`
Native dialer is full keypad+Twilio+DTMF+recents (richer than prototype). **Bank section = NEW** on
both. Service catalog «Κατάλογος υπηρεσιών» exists but may be empty/stub — decide scope. Templates +
merge tokens exist; verify token substitution at send.

### Design system / rebrand — **DONE (not a build)**
Web `globals.css` already remaps the ramp to navy `#11273B`/`#1A3550` + water-blue `#2A86C5` with full
dark mode; native `theme.ts` already uses the prototype's final palette + full dark. **No rebrand
build.** Residue only: hard-coded accent literals (native dots `#3361FF`/`#21A05A`/`#D14343`; web
AppShell `bg-indigo-600`); add a **`--neutral` token for `#9AA6B2`** (lost/neutral grey, hardcoded in
`dot-lost`/`s-lost`/stats legend). The prototype's success/warn/danger = `#18A06A`/`#E0922F`/`#DA4A4A`
(light) — already the brand semantic ramp. **Skip** the tunable accent/radius/glow/fontScale knobs
(cosmetic, complex; keep the existing dark toggle). Bottom nav order (prototype): **Κλήσεις · Αρχική ·
[AI FAB] · Πελάτες · Ρυθμίσεις** (centered FAB).

---

## 2. Staged plan (dependency-ordered, each = one PR)

- **Stage 0 — DONE.** Merge #239 (chat-first folders) → master (`088c124`).
- **Stage 1 — Schema: `step` [backend]** — migration `047`: `ALTER TABLE work_folders ADD COLUMN step
  smallint NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 4);`. Plumb through `work-folders.ts`
  (`dbToFolder`), folder GET/POST/PATCH, `public-folder.ts`. Code **tolerates a missing column**
  pre-apply (treat as 0). No UI. Owner applies SQL in Supabase editor (no `db push`).
- **Stage 2 — «Έργο» rename [web]+[native]** — copy-only sweep: "Φάκελος εργασίας" → «Έργο» across
  web + native UI strings. Cheap, isolated, high-visibility.
- **Stage 3 — Stepper + project pill, technician [web] → [native]** — `Stepper` component (done/now/
  todo) + header project-switcher pill + switch sheet; ⋯ menu Παράλειψη βήματος / Ολοκλήρωση wired to
  `step` PATCH; mini-stepper on profile project cards; server auto-advance on offer/accept events.
- **Stage 4 — Portal v2: stepper + offer accept + appointment + Q&A thread [web]** — refactor
  offer-response + appointment-response into shared libs; embed inline Αποδοχή/«Έχω απορία» +
  Επιβεβαίωση/Αλλαγή ώρας into `f/[token]/page.tsx` via the token bridge; render Q&A thread; add
  Stepper to portal; upload-from-portal; multi-project switcher.
- **Stage 5 — Native folder-scoped chat workspace [native]** — promote native work folder from a
  profile sub-section to a first-class chat-first screen (reuse `customers/[id]/index.tsx` pattern,
  scoped by `work_folder_id`); thread `workFolderId` through outbound message (backend touch).
- **Stage 6 — Native PortalPreview [native]** — read-only native screen mirroring the finished web
  portal (eye → «Προβολή ως πελάτη»), reusing `public-folder.ts` scoping.
- **— PAYMENTS WAVE (separate review) —**
- **Stage 7 — Schema: payments + bank [backend]** — migration `048`: bank columns on `businesses`
  (nullable) + `payment_requests` table (046 tenant pattern: `business_id NOT NULL` + `UNIQUE(business_id,id)`,
  `work_folder_id FK ON DELETE SET NULL`, `offer_id`, `kind CHECK(deposit|balance)`, `pct`, `amount`,
  `currency`, `status CHECK(pending|declared|confirmed|cancelled)`, `declared_at`, `confirmed_at`,
  `receiving_account` IBAN snapshot, RLS via `business_users`). APIs: `POST /api/folders/[id]/payment-request`
  (amount server-computed from offer gross), `GET` list, public `POST /api/f/[token]/payment`
  (token-validated declare + push owner), `PATCH /api/payments/[id]` (owner confirm → `pay` event + optional step advance).
- **Stage 8 — Bank settings + PaymentRequestSheet + portal payment card [web]→[native]** — bank fields
  in settings; PaymentRequestSheet (3 entry points); portal PortalPayment (BankRows + CopyBtn +
  «Δήλωσα την κατάθεση»); owner-confirm UI.
- **Stage 9 — Branded Offer PDF bank block [web]→[native]** — add bank + deposit-terms to
  `OfferPreview.tsx`; native OfferDoc + `expo-print` matching web layout/totals exactly.
- **Stage 10 — Polish [design]** — `--neutral` token + hard-coded literals → tokens; align public-page
  surfaces; template merge-token substitution if missing; stats aggregates if missing.

**Web-first stages:** 3/4/8/9. **Native-catch-up:** 5/6 (+ native halves of 3/8/9). Surface-neutral: 1/2/7.

---

## 3. Risks & fidelity guards
- **Tenant isolation:** `payment_requests` follows migration-046 exactly (composite tenant-safe FKs,
  RLS via `business_users`, explicit `business_id` filter on every service-role query). Public declare
  endpoint token-validated (SHA-256, fail-closed), exposes zero internal IDs.
- **PII/public leak:** `public-folder.ts` excludes notes + internal IDs; adding payment/bank to the
  public page keeps fail-closed discipline — expose only the **receiving IBAN snapshot** + the
  customer's own amount. Internal note never reaches the portal.
- **Cross-surface consistency:** Offer PDF must produce identical layout/totals web (print) + native
  (`expo-print`). Stepper status↔step mapping pinned identically on web + native + portal.
- **Migration discipline:** `047`/`048` are additive (nullable / default) and **applied manually via
  the Supabase SQL editor** (no `db push`). Step CHECK + folder validation ship together. Code degrades
  gracefully pre-apply.
- **GDPR:** payment records hold financial intent + IBAN tied to a customer — covered by existing
  customer data-retention/erasure. The `payment_requests.receiving_account` is a **snapshot** (historical
  docs stay correct) duplicating the business IBAN — documented.

## 4. Key files
- **Backend:** `src/lib/server/work-folders.ts` (add `step`), `src/lib/server/public-folder.ts`
  (surface step + payment/bank, fail-closed), `src/app/api/folders/[id]/`,
  `src/app/api/customers/[id]/folders/`, `src/app/api/businesses/me/` (bank whitelist),
  `supabase/migrations/` (047 step, 048 payments — none exist past 046).
- **Web:** `src/app/f/[token]/page.tsx` (Portal v2), `src/components/customers/FolderDetailPanel.tsx` +
  `CustomerFoldersStrip.tsx` + `MessengerTimeline.tsx` (#239 — stepper/⋯/payment),
  `src/app/offer-response/[id]/OfferResponseClient.tsx` + `appointment-response` (→ shared lib),
  `src/components/offers/OfferPreview.tsx` (PDF bank block), `src/app/(app)/settings/` (bank).
- **Native:** `native/src/app/customers/[id]/index.tsx` (chat-first folder scope + stepper),
  `native/src/components/work-folders-section.tsx`, `native/src/app/settings.tsx` (bank),
  `native/src/components/offer-preview-sheet.tsx` (branded PDF) + new `PortalPreview` screen,
  `native/src/lib/theme.ts` (palette — already on-brand).
