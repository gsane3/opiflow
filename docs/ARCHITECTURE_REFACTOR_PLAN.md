# Opiflow — Architecture Refactor Plan (zero-Live-impact)

> Σκοπός: να περάσει το backend από «70% σωστό layered monolith που δεν επιβλήθηκε
> ομοιόμορφα» σε ένα **boring, production-grade** modular monolith — **χωρίς να
> αλλάξει η συμπεριφορά του Live ούτε στο ελάχιστο**, ένα μικρό αναστρέψιμο PR τη φορά.
>
> Δεν αλλάζουμε stack (Next.js, Supabase, Expo, Asterisk/Twilio μένουν). Αλλάζουμε
> **πώς είναι οργανωμένη η λογική**. Βασίζεται στην ανάλυση στο
> `docs/OPIFLOW_OVERVIEW_GR.md` + στο πραγματικό repo.
>
> **Ξεκίνησε:** 2026-06-25 (PR-1 σε αυτό το branch).

---

## 0. Το μοντέλο «ΜΗΔΕΝ επίδραση στο Live»

Το Live επηρεάζεται **μόνο** με **merge στο `master`** (η Vercel κάνει auto-deploy).
Άρα κάθε βήμα τηρεί τους εξής κανόνες:

1. **Additive πρώτα.** Νέος κώδικας σε `src/server/**` που **δεν τον κάνει import κανένα
   live route** → ο running κώδικας μένει byte-for-byte ίδιος, ακόμη κι αν γίνει deploy.
2. **Adoption route-by-route, πίσω από ΙΔΙΟ response shape.** Όταν μετατρέπουμε ένα route,
   το νέο μονοπάτι επιστρέφει **ακριβώς** το ίδιο JSON ({ ok, ... } / { ok:false, error }).
   Το αποδεικνύουμε με **snapshot test** της απόκρισης πριν σβήσουμε τον παλιό κώδικα.
3. **Ένα μικρό, αναστρέψιμο PR τη φορά**, με πράσινο **CI** (tsc + vitest + next build).
   Κάθε PR γίνεται merge **μόνο με δική σου έγκριση**· revert = ένα κλικ.
4. **Αλλαγές συμπεριφοράς (jobs, outbox) μπαίνουν ΑΔΡΑΝΕΙΣ πίσω από flag/env** και
   ενεργοποιούνται όταν το πεις — ποτέ «big bang».
5. **Καμία αλλαγή στη ροή migrations** (μένει manual) και **κανένα άγγιγμα στο live PBX**
   μέχρι να επικυρωθεί σε staging.

> **PR-1 (αυτό το branch) δεν γίνεται merge αυτόματα.** Δεν αλλάζει κανένα route. Μπορείς
> να το κάνεις merge όποτε θες — είναι αποδεδειγμένα no-op για το runtime.

---

## 1. Η αρχιτεκτονική-στόχος

```
Web / Native / Public Portal
        │            (typed API client — shared schemas/types)
        ▼
Thin Next.js route handlers   ── auth + parse + call service + map error
        ▼
Domain services (business logic)        src/server/modules/<domain>/*.service.ts
        ▼
Repositories (tenant-safe DB access)    src/server/modules/<domain>/*.repo.ts
        ▼
tenantDb(ctx) → Supabase Postgres       src/server/core/tenant.ts

Πλάγια συστήματα:
  • Job queue  → AI / transcription / notifications (durable, retries)
  • Outbox     → Viber/SMS/email/webhooks (idempotent, no lost/double sends)
  • PBX-as-code (git templates + provisioner + staging box)
  • Observability (correlation IDs) + audit log
```

---

## 2. Πού βρισκόμαστε (τι υπάρχει ήδη)

Πλήρης χάρτης στο chat/overview. Περίληψη: **υπάρχει ήδη** service layer
(`src/lib/server/*` ~43 modules, `src/lib/billing/*`, `src/lib/ai/*`), per-module tests,
`audit_events`, `send-channel.ts` (messaging adapter), `observability.ts`, `env.ts`,
inbound idempotency (`provider_webhook_events`), public-portal boundary
(`public-folder.ts` με sanitized DTOs). **Λείπουν πραγματικά:** generated types, Zod,
tenant-safe wrapper, central error model, outbox (outbound), PBX-as-code, CI,
correlation IDs.

---

## 3. Η σειρά (PR-by-PR)

### Φάση Α — Foundation (μηδέν αλλαγή συμπεριφοράς)

| PR | Τι | Πώς μένει zero-Live |
|----|----|----|
| **PR-1 ✅ (εδώ)** | `src/server/core/{errors,tenant,http}.ts` + `customers` reference module (schema/types/repo/service) + tests + Zod dep + CI + types tooling + αυτό το plan | Όλα additive· **κανένα** live route δεν τα κάνει import. |
| **PR-2** | `npm run db:types` → πραγματικά `database.types.ts`· wire `Database` στο supabase client + `tenantDb` | Type-only (σβήνεται στο build). Μηδέν runtime. |
| **PR-3** | ESLint rule «no `@/lib/supabase/server` import μέσα σε `src/app/api/**/route.ts`» — **ως warning** αρχικά | Warning δεν σπάει το build/deploy. Γίνεται `error` αφού μεταναστεύσουν τα routes. |

### Φάση Β — Route-by-route adoption (ένα domain τη φορά, ίδιο response)

| PR | Τι | Πώς μένει zero-Live |
|----|----|----|
| **PR-4** | Μετατροπή `/api/customers` (GET+POST) στο `customers` module· thin route + `handleApiError` | **Snapshot test** ότι το JSON είναι identical πριν σβηστεί ο παλιός κώδικας. Μικρό, αναστρέψιμο. |
| **PR-5..N** | Ένα domain ανά PR: `offers`, `folders/projects`, `tasks`, `calls`, `billing`, `telephony`, `ai`, `public-portal` (το τελευταίο έχει ήδη boundary — απλώς μετονομασία/μετακόμιση) | Ίδιο pattern: identical response + tests + CI green, ένα-ένα. |

### Φάση Γ — Production reliability (πίσω από flags/env, αδρανές μέχρι το flip)

| PR | Τι | Πώς μένει zero-Live |
|----|----|----|
| **PR-x** | **Durable job queue** για το tail κλήση→transcription→AI→notify (πάνω στο υπάρχον `jobs` table ή Upstash QStash). Νέο μονοπάτι **dormant**· ο webhook συνεχίζει inline μέχρι το `JOBS_ENABLED` flip | Flag default off → ίδια συμπεριφορά· flip όταν το πεις. |
| **PR-y** | **Outbox** για outbound (Viber/SMS/email) + idempotency keys | Διπλό-γράψιμο (outbox + υπάρχον send) πίσω από flag· επαλήθευση· μετά cutover. |
| **PR-z** | **Correlation IDs** σε `observability.ts` + νήμα σε call flow· **audit log** πιο πλήρες | Additive logging· μηδέν αλλαγή απόκρισης. |

### Φάση Δ — Scale & ops

| PR | Τι | Πώς μένει zero-Live |
|----|----|----|
| **PR** | **CI required check** (αφού πρασινίσει σταθερά) | GitHub-only· δεν αγγίζει Vercel. |
| **PR** | **PBX-as-code**: όλα τα Asterisk templates στο git + provisioner + **staging PBX** + restore runbook | Χτίζεται/επικυρώνεται σε **staging box**· το live box δεν αγγίζεται· cutover = ξεχωριστή, προγραμματισμένη εργασία. |
| **PR** | **Migration pipeline** (commit schema + apply-σε-CI/shadow-DB) → σβήνει τα defensive `retry-without-column` | Read-only validation· δεν αλλάζει το live apply (μένει manual μέχρι να εμπιστευτούμε το pipeline). |
| **PR** | **Min-app-version gate** (αντί για `/v1/` URLs) + shared API client (μοιρασμένα Zod schemas/types web↔native) | Additive· additive-only responses. |
| **(προαιρετικά)** | Feature flags table (αν χρειαστεί dark-launch — σήμερα καλύπτεσαι από per-business booleans) | Additive. |

> **North star (όχι τώρα):** σταδιακά να επιβληθεί η απομόνωση tenant στη **βάση** με RLS +
> το JWT του χρήστη, κρατώντας το service-role μόνο για cross-tenant ops. Ο `tenantDb`
> wrapper είναι το πραγματικό «80%» μέχρι τότε.

---

## 4. Τι περιέχει το PR-1 (αυτό το branch)

**Νέα αρχεία (additive, κανένα live import):**
- `src/server/core/errors.ts` — `AppError`, `handleApiError`, `ok`/`fail` (ίδιο `{ ok }` wire format).
- `src/server/core/tenant.ts` — `tenantDb(client, businessId)`: επιβάλλει `.eq('business_id')`
  σε κάθε select/update/delete και βάζει `business_id` στα inserts.
- `src/server/core/http.ts` — `requireBusinessUser` (throw-style πάνω στο υπάρχον
  `authenticateBusinessRequest`) + `assertOwner`/`assertManager`.
- `src/server/modules/customers/*` — **reference module**: `customers.schema.ts` (Zod,
  parity με το route), `customers.types.ts`, `customers.repo.ts` (μέσω `tenantDb`),
  `customers.service.ts`, `__tests__/customers.test.ts`. **Δεν** το χρησιμοποιεί το live
  `/api/customers` — δείχνει μόνο το target pattern.
- `src/server/db/database.types.ts` (placeholder) + `src/server/db/README.md` + script `db:types`.
- `docs/ci/ci.yml.example` — CI workflow (tsc + vitest + next build web · tsc native).
  Παρέχεται ως example γιατί το token του assistant δεν έχει `workflow` scope· πρόσθεσέ το
  στο `.github/workflows/ci.yml` μέσω του GitHub UI (μία φορά).

**Άλλαξε μόνο:** `package.json` (πρόσθεση `zod` + script `db:types`). **Κανένα route, κανένα
flow, καμία migration, κανένα PBX.**

**Verification:** `npx tsc --noEmit` · `npx vitest run` · `npx next build` — όλα πράσινα.

---

## 4b. Επιπλέον σε αυτό το branch (Phase 2 — όλα additive/unwired, verified green)

- **Domain modules** `src/server/modules/{tasks,offers}/*` (schema/types/repo/service + tests),
  parity-matched στα live `/api/tasks` & `/api/offers` — δείχνουν ότι το pattern κλιμακώνεται
  (offer_items, ownership validation). Τα live routes **δεν** αγγίχτηκαν.
- **Job queue** `src/server/jobs/queue.ts` πάνω στο υπάρχον `jobs` table (030): durable,
  optimistic claim, linear backoff, handler registry. (Phase Γ, #6)
- **Outbox** `src/server/outbox/outbox.ts` + migration **063_outbox_events** (νέος πίνακας,
  RLS service-role-only): idempotent outbound με dedup-key + retries. (Phase Γ, #7)
- **Correlation IDs** `src/server/core/correlation.ts` + context-bound structured logs. (#19)
- **Migration pipeline**: `scripts/build-schema.mjs` → `supabase/schema.sql` (single committed
  view· `npm run db:schema` / `db:schema:check` για CI drift-check). (Phase Δ)
- **PBX-as-code scaffold** `infra/pbx/*` (README + Ansible playbook + restore runbook) — κάνει
  το PBX reproducible· το live box **δεν** αγγίζεται (μένει ένα read-only dump των base configs
  ως `TODO(extract)`). (#9, το #1 SPOF)
- **Worker example** `docs/examples/cron-worker.md` — wire job/outbox worker πίσω από
  `CRON_SECRET` + `WORKER_ENABLED` flag (dormant μέχρι το flip).

**Σκόπιμα ΕΚΤΟΣ (για adoption με δική σου έγκριση):** καμία μετατροπή live route, κανένα νέο live
endpoint, καμία εφαρμογή migration, κανένα άγγιγμα σε PBX/Supabase/Vercel. Όλα σε draft PR, χωρίς merge.

---

## 5. Κανόνας για κάθε επόμενο PR

1. Μικρό & ένα domain/θέμα τη φορά.
2. CI πράσινο (tsc + vitest + build).
3. Αν αγγίζει live route → **snapshot test** ότι η απόκριση είναι identical.
4. Αν αλλάζει συμπεριφορά → **πίσω από flag/env**, default off.
5. Merge **μόνο** με τη δική σου έγκριση.
