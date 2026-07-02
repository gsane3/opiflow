# Αρχιτεκτονικό χρέος — καταγραφή s45 (2026-07-02)

> Ευρήματα από το structure review του s45 (modular-monolith adoption ~80% ολοκληρωμένο).
> **Τίποτα εδώ δεν είναι επείγον** — η δομή κρίθηκε ΣΩΣΤΗ (100/105 thin routes, 45 modules
> με colocated tests, καθαρό core). Αυτά είναι τα «κάποια στιγμή», με σειρά προτεραιότητας.
> ΚΑΝΟΝΑΣ όταν εκτελεστούν: only reorganize, NEVER change behavior (byte-identical responses).

## 1. 🔴 Απορρόφηση του `src/lib/server` στα modules (το μεγαλύτερο)

Το domain logic έχει σήμερα **δύο σπίτια**: `src/server/modules/*` ΚΑΙ το legacy
`src/lib/server` (**44 αρχεία** με πραγματική λογική — payments, work-folders, push,
twilio-recording, token stores, apifon). **46 module αρχεία** κάνουν import από εκεί,
οπότε πολλά modules είναι λεπτά κελύφη πάνω από το παλιό layer (π.χ. η αποδοχή προσφοράς
ζει στο `lib/server/offer-accept.ts`, όχι στο offers module). Για να καταλάβεις ένα
domain διαβάζεις 3 στρώματα: route → module service → lib/server helper.

**Σειρά απορρόφησης (κατά αριθμό imports):**
| lib/server helper | imports | προορισμός |
|---|---|---|
| `push.ts` | 12 | `modules/push` (υπάρχει ήδη service-only) |
| `upload-tokens.ts` | 8 | `modules/uploads` ή core/tokens |
| `payments.ts` | 7 | `modules/payments` (νέο) |
| `intake-tokens.ts` | 6 | `modules/intake` |
| `twilio-recording.ts` | 5 | `modules/calls` ή `webhooks-voice` |
| υπόλοιπα 39 αρχεία | 1-4 | ανά domain |

Ένα PR ανά helper-cluster, με τα υπάρχοντα tests να περνάνε αμετάβλητα.

## 2. 🟠 Ενοποίηση των δύο auth entry points

Δύο helpers συνυπάρχουν: `src/server/core/http.ts` `requireBusinessUser` (**54 routes**,
το κανονικό) και το legacy `src/lib/api/auth.ts` (**20 routes**). Κάθε νέο route πρέπει
σήμερα να «διαλέξει», και τα δύο μπορούν να αποκλίνουν σε error codes/token handling.
**Ενέργεια:** migrate τα 20 legacy routes στο core/http (έλεγχος ότι τα error responses
μένουν byte-identical), μετά διαγραφή του `lib/api/auth.ts`.

## 3. 🟠 Εξαγωγή των 3 «χοντρών» routes που δεν υιοθετήθηκαν ποτέ

| route | γραμμές | σημείωση |
|---|---|---|
| `api/appointment-response/[token]/route.ts` | 446 | inline columns/interfaces/DB — τα modules appointment-links & appointment-notifications ΥΠΑΡΧΟΥΝ, αλλά αυτό δεν εξήχθη ποτέ |
| `api/folders/[id]/link/route.ts` | 283 | → modules/folders |
| `api/calls/recording/route.ts` | 131 | → modules/calls ή webhooks-voice |

(Τα health + cron/outbox routes είναι νόμιμα εκτός pattern — infra.)

## 4. 🟡 Schema layer: 4/45 modules έχουν πραγματικό schema.ts

Zod schemas μόνο σε customers/offers/tasks/invoicing· αλλού hand-rolled validation
(`str()`/`optionalNumber()` ξαναδηλωμένα ανά service — ακόμα και το offers.service
κάνει hand-roll ενώ ΕΧΕΙ schema.ts που εξάγει μόνο OFFER_STATUSES). Σκόπιμο (byte-identical
error parity), αλλά ~40 services με διπλότυπη validation. **Ενέργεια:** όταν αγγίζεται
ένα module για feature δουλειά, μεταφέρουμε τη validation σε schema.ts με custom error
mapping που κρατά τα ίδια error codes. Όχι big-bang.

## 5. 🟡 Service-only modules που παρακάμπτουν repo + tenantDb

10 modules είναι service-ONLY (χωρίς repo): bank-accounts, customer-reply-draft,
exempt-numbers, messaging-settings, next-action, notifications, offer-notify, push,
suggested-actions, team. Τα 8 κάνουν raw `.from()` μέσα στο service με χειροκίνητο
`.eq('business_id', …)` (π.χ. `team.service.ts:79`) — η tenant ασφάλεια εκεί στηρίζεται
σε πειθαρχία + το tenant-isolation-audit test, όχι στον wrapper. **Ενέργεια:** προσθήκη
repo layer με `tenantDb` σε αυτά τα 8, ξεκινώντας από team (auth-sensitive).

## 6. 🟡 Import υγιεινή

Τα modules κάνουν import το lib μέσω βαθιών σχετικών paths (`'../../../lib/server/…'`,
π.χ. offers.service.ts:10) ενώ τα routes χρησιμοποιούν το `@/` alias. **Ενέργεια:**
codemod σε `@/` παντού μέσα στα modules (καθαρά μηχανικό).

## 7. 🟠 Υγιεινή root φακέλου (τοπικό, όχι git — αλλά ρίσκο)

Στο root του working tree κάθονται **loose secrets & artifacts**: `AuthKey_*.p8` Apple
keys, `twilio_2FA_recovery_code.txt`, `ios-voip-cert/`, zips, PDFs, 2 mojibake-named
φάκελοι (αλλοιωμένα ελληνικά ονόματα). Επιβεβαιωμένα **gitignored/untracked** — δεν
υπάρχει leak — αλλά ζουν σε φάκελο που σαρώνεται από tooling/zips. **Ενέργεια (owner):**
μεταφορά credentials σε `E:\opiflow-secrets\` (εκτός repo), διαγραφή mojibake dirs,
καθάρισμα zips/PDFs.

## 8. 🟡 docs/ index

35+ αρχεία στο docs/ χωρίς index, με stale plans (REDESIGN_PLAN, FIXLIST) δίπλα στο
ζωντανό ARCHITECTURE_REFACTOR_PLAN.md. **Ενέργεια:** `docs/README.md` index με
live/stale σήμανση, μεταφορά stale σε `docs/archive/`.

## 9. 🟡 Native test coverage

Το vitest τρέχει μόνο `src/**/*.test.ts` — το `native/src` δεν έχει καθόλου tests στο
main runner (μόνο tsc). **Ενέργεια:** jest-expo ή vitest project για ό,τι native είναι
καθαρή λογική (lib/api error layer, intake-prompt, parsing) — όχι UI snapshots.

## 10. ℹ️ Καταγεγραμμένα & αποδεκτά (όχι ενέργεια)

- Migration numbering gap: το **049 λείπει** (048 → 050) — δεν είναι χαμένο αρχείο,
  απλώς κενό νούμερο· ΟΚ για το manual-apply workflow.
- `unstable_settings` initialRouteName μόνο στο customers stack (#449) — αν προστεθούν
  νέα nested stacks σε tabs (π.χ. invoices), θέλουν το ίδιο anchor.
- Ο invoicing είναι ο χρυσός οδηγός module (πλήρες types/config/logic/schema/repo/service)
  — νέα modules αντιγράφουν ΑΥΤΟΝ.

---

*Πηγή: s45 structure review (4-agent code recon). Ενημέρωσε αυτό το αρχείο όταν
εκτελείται κάποιο τμήμα — μην ανοίγεις νέο doc.*
