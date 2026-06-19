# Opiflow — Λίστα διορθώσεων (FIXLIST)

Από τον έλεγχο 2026-06-19 (59 ευρήματα) + τις παρατηρήσεις του ιδιοκτήτη (U1–U13).
Τα πιάνουμε **ένα-ένα**. `👤` = παρατήρηση ιδιοκτήτη · `S/M/L` = μέγεθος δουλειάς.

---

## ✅ Έγιναν & είναι LIVE
- [x] **U1** Κατάργηση παλιού «send link» μενού προσφοράς · συγκεντρωτική λίστα υπάρχει στο `/offers` — PR #307
- [x] **U2** Date/time stamps στις ενέργειες του έργου — PR #307
- [x] **U8** AI σε κλητική («κύριε Μαρινόπουλε») — PR #308
- [x] **#15** Αναζήτηση πελατών δεν σπάει με κόμμα/injection — PR #305
- [x] **#24** ΦΠΑ προσφοράς clamp 0–100% — PR #305
- [x] **#18** Διαγραφή έργου: φρένο σε επιβεβαιωμένες πληρωμές — PR #305
- [x] **#19/#57** Health billing αλήθεια · domain πληρωμών → opiflow.ai — PR #305
- [x] **#54/#52/#41** Invalid Date · payreq CTA · «Email Ανενεργό» — PR #305
- [x] **#17** Σελίδα ηχογράφησης (apex→www) — PR #305
- [x] **#20/#56/#33** rate-limit δημόσιων GET · offer-PDF no-cache · επιβεβαίωση διαγραφής μέλους — PR #306

---

## 🔴 A — Σπασμένα / πελατειακά (πάμε πρώτα)
- [x] **A1 · #10** Ραντεβού: η επιβεβαίωση κρατάει πλέον (durable, χωρίς migration — seed από το μήνυμα αποδοχής). — PR #310
- [x] **A2 · #11** Ο πελάτης βλέπει live τις απαντήσεις σου στο τσατ (GET /api/f/[token]/message + polling 12s). — PR #312
- [x] **A3 · #12** «Νέο έργο»: διορθωμένο copy (web+native) — δεν υπόσχεται αυτόματο SMS· ο σύνδεσμος στέλνεται από το έργο. — PR #313
- [x] **A4 · #13/#14** Owner ενέργειες: error toast σε κάθε αποτυχία (ProjectProcess) + loading/error/not-found οθόνη στο προφίλ (CustomerProfile) — όχι πια σιωπηλές αποτυχίες / κενό «Πελάτης». — PR #314
- [~] **A5 · U9/#9/#8** SMS: ο κώδικας (apifon-sms/viber) **ελέγχθηκε — σωστός** (mirrors το working Viber). Προστέθηκε privacy-safe logging της απόρριψης Apifon + οδηγός `docs/APIFON_SMS_LIVE_TEST.md`. — PR #315 · **⏳ μένει: ζωντανή δοκιμή με owner creds** (βλ. O-items) + recording webhook (PBX-config, owner).
- [x] **A6 · #16** «Καρφίτσωμα» πελάτη: ταξινόμηση pinned-first σε επίπεδο **DB** (όχι in-memory στη σελίδα) → οι καρφιτσωμένοι μένουν στην κορυφή και με σελιδοποίηση. — PR #316

## 🟡 B — Δικά σου features
- [~] **B1 · U4** Αρχική NBA όπως στο τσατ — **DEFER (owner design + perf):** το CAM engine είναι per-folder/customer· business-wide aggregate = N+1 (~7 queries × κάθε folder) + side-effectful persist. Η αρχική ΕΧΕΙ ήδη «Τι πρέπει να γίνει τώρα» (HomeActionChips + NextActionsSection). Χρειάζεται απόφαση: single CAM card για τον top πελάτη ή λίστα; + read-only aggregate για perf.
- [x] **B2 · U7** Επαφές **αλφαβητικά** (server `sort=name`, pins-first διατηρείται) + toggle «Αλφαβητικά Α–Ω». Το «Χωρίς στοιχεία» καλύπτεται ήδη από το filter «Αναμονή στοιχείων» (inbound χωρίς όνομα). — PR #317
- [x] **B3 · U6** Επαφές κινητού vs app: toggle «Απόκρυψη επαφών κινητού» (web parity με native, `importedFromPhone`, εμφανίζεται μόνο όταν υπάρχουν). — PR #317
- [ ] **B4 · U12 · L** 👤 Ρυθμίσεις σε κατηγορίες/υποκατηγορίες — **DEFER (μεγάλο redesign):** θέλει information-architecture απόφαση του owner (ποιες κατηγορίες/σειρά). *(settings shell)*
- [ ] **B5 · U11 · L** 👤 Premium/branded οθόνη κλήσης — **DEFER (design + device):** native calls.tsx + web in-call· θέλει εικαστική κατεύθυνση + δοκιμή σε συσκευή.
- [ ] **B6 · U3 · L** 👤 Συνέπεια spacing/παραθύρων — **DEFER (global design pass):** ο web `/customers` list είναι ακόμη Tailwind ενώ το προφίλ/έργο είναι opf-prototype· χρειάζεται ενιαία απόφαση migration.
- [ ] **B7 · #4/U5 · L** 👤 Native εισερχόμενες κλήσεις — **DEFER (owner/device):** θέλει build + δοκιμή σε συσκευή + Twilio Android FCM push credential (O-item).

## 🟢 Γ — Polish / μικρότερα (από τον έλεγχο)
- [ ] **Γ1 · #25 · S** Απόρριψη προσφοράς από πελάτη / σταμάτημα «Ελέγξτε» nag.
- [ ] **Γ2 · #26 · M** Portal: badge «Στάλθηκαν N φωτογραφίες».
- [ ] **Γ3 · #29 · S** «Έχω απορία» να φέρει context προσφοράς στο τσατ.
- [ ] **Γ4 · #23 · S** Λήξεις προσφοράς/ραντεβού με ώρα Αθήνας (DST).
- [ ] **Γ5 · #45 · M** Routes που λύνουν business με owner_id → χαλάνε για προσκεκλημένα μέλη.
- [ ] **Γ6 · #32 · S** Presence toggle «Σύντομα» — ξεκαθάρισμα (το DND ήδη ισχύει).
- [ ] **Γ7 · #30 · S** Native in-call overlay εξαφανίζεται στιγμιαία σε αποτυχία.
- [ ] **Γ8 · #51/#40 · S** Inbound: reject αντί νεκρού `<Say>` · log στο DND fail.
- [ ] **Γ9 · #39/#22/#49 · M** Apifon webhook tenant check · voicemail multi-tenant · PBX brief match.
- [ ] **Γ10 · #36/#35/#37 · M** Onboarding inline errors · window.confirm σε CustomerProfile · voucher atomic.
- [ ] **Γ11 · #27/#28/#55 · M** Portal: πολλαπλές προσφορές/ραντεβού · ελεύθερη αλλαγή ώρας · multiline τσατ.
- [ ] **Γ12 · #42 · M** Σύνδεσμος έργου: μην περιστρέφεται μετά τη λήξη 30 ημερών.

## ⚪ Owner-action / αργότερα
- [ ] **O1 · #1 · S** Migration: GRANT στο `payment_requests` (να το γράψω, να το τρέξεις στο Supabase).
- [ ] **O2 · #43** Επιβεβαίωση ότι δεν λείπει migration 049 στη ζωντανή βάση.
- [ ] **O3 · Migration 055** (own-voice εισερχόμενες) + PBX Part 2 (own-voice εξερχόμενες).
- [ ] **O4 · Stripe (L6/#2/#3/#5/#6/#7)** Entitlement/trial gate + σωστή τιμή ανά πλάνο + dunning — *όταν ανοίξεις χρεώσεις*.
- [ ] **O5** Νέο Android build (έχει τα νέα fixes) + δοκιμή σε συσκευή.

---
*Σειρά: A → B → Γ. Τσεκάρουμε εδώ ό,τι κλείνει.*
