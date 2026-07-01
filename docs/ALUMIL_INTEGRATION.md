# Opiflow — Κάθετο add-on: Αλουμινάδες & Μαραγκοί (ALUMIL integration)

> **STATUS: PLANNING / SPEC — δεν έχει ξεκινήσει κώδικας.** Καταγραφή οράματος +
> αρχιτεκτονική + ανοιχτά ερωτήματα. Ο owner δίνει το «go» για τη Φάση 0.
> **Blocker Β (laser/3D) = ΛΥΜΕΝΟΣ** (s45, sourced research). Μένουν **Α** (ALUMIL κανάλι/catalog)
> και **Γ** (domain/inbound email) — και τα δύο owner-side, όχι τεχνικά.

Τελευταία ενημέρωση: **session 45 (2026-07-01)**.

---

## 0. Τι είναι

Ένα **industry add-on (κάθετο)** πάνω από τα base features του Opiflow, για
δύο κλάδους: **(1) αλουμινάδες** και **(2) μαραγκούς**. Αυτοματοποιεί όλη την αλυσίδα
από τη **μέτρηση στον χώρο** μέχρι την **προσφορά στον τελικό πελάτη** και το **τιμολόγιο**,
με **αποκλειστική συνεργασία προμηθευτή (ALUMIL)** για το αλουμίνιο.

### Ορολογία (ΚΡΙΣΙΜΟ — να μη μπερδευτεί)
- **«πελάτης» / χρήστης = ο αλουμινάς/μαραγκός** (ο συνδρομητής του Opiflow).
- **«τελικός πελάτης» = ο δικός του πελάτης** (το νοικοκυριό/η οικοδομή).
- **ALUMIL = ο προμηθευτής συστημάτων αλουμινίου** (extruder/systems house).

---

## 0.5 ✅ ΑΠΟΦΑΣΕΙΣ ΠΟΥ ΚΛΕΙΔΩΣΑΝ (s45)

| Θέμα | Απόφαση |
|---|---|
| **Συσκευή μέτρησης** | **Bluetooth laser — Leica DISTO ΚΑΙ Bosch** από την αρχή. **ΧΩΡΙΣ LiDAR** στο MVP. |
| **3D / σχήμα** | **Παραμετρικό 2D σχήμα**, παραγόμενο **από τις ίδιες τις μετρήσεις** (όχι από LiDAR scan). |
| **Ροή μέτρησης** | Guided: διαλέγεις πλευρά ανοίγματος → μετράς με laser → έρχεται η τιμή → **αποδοχή** → επόμενη πλευρά. Στο τέλος βγαίνει το σχήμα. |
| **Relay email domain** | **`opiflow.ai`** (π.χ. `onomaetaireias@opiflow.ai`). |
| **Κανάλι ALUMIL** | Ο owner **έχει επαφή** → ο Blocker Α γίνεται «ρώτα τον» (κανάλι + catalog), όχι «άγνωστο». |
| **Matching απάντησης** | Κρυφό **token στο θέμα** `[OPF-1234]` (όχι όνομα έργου — εύθραυστο). |

**Το κρίσιμο insight:** οι ακριβείς διαστάσεις (mm) έρχονται **αποκλειστικά από το laser**·
ο wizard τρέχει ολόκληρος **σε κάθε κινητό** χωρίς LiDAR. Το 2D σχέδιο του κουφώματος
παράγεται παραμετρικά από πλάτος×ύψος(×βάθος κάσας). Το LiDAR/3D μένει ως **προαιρετικό
enhancement για αργότερα** (μόνο iPhone Pro), όχι προϋπόθεση.

---

## 0.6 ⏸️ ΣΕ ΑΝΑΜΟΝΗ — ο owner φέρνει απαντήσεις (resume checklist)

> Καμία τεχνική εξάρτηση δεν μπλοκάρει πλέον — μόνο αυτές οι owner-side απαντήσεις. Μόλις
> έρθουν → **Φάση 0** (και μετά Φάση 1 native BLE, ήδη σχεδιασμένη). Δεν γράφεται κώδικας ως τότε.

- [ ] **Α1 — Κανάλι ALUMIL:** πώς δέχονται αίτημα προσφοράς σήμερα; email quote-desk / B2B portal / API;
      (+ ποια διεύθυνση/endpoint). → καθορίζει το outbound του βήματος 7.
- [ ] **Α2 — Catalog ALUMIL:** μας δίνουν λίστα **συστημάτων/σειρών + χρωμάτων/RAL + εξαρτημάτων**
      για το dropdown (#6); Και: η προσφορά τους περιλαμβάνει **τζάμια/κοπή/εξαρτήματα** ή μόνο προφίλ;
- [ ] **Α3 — Μορφή προσφοράς** που επιστρέφει (PDF / Excel / κείμενο) → ρυθμίζει το AI-parse.
- [ ] **Γ1 — Domain:** κατοχύρωση **`opiflow.ai`** + επιλογή inbound-email provider (Postmark / Mailgun / …).
- [ ] **Δ1 — Φόρμουλα τιμής:** `τελική = ALUMIL×(1+markup%) + εργατικά`; τα εργατικά = συνολικά / ανά κούφωμα / ανά m²;
- [ ] **Ε1 — Μαραγκοί:** υπάρχει αντίστοιχος προμηθευτής, ή μόνο **μέτρηση + auto-σχήμα + χειροκίνητη προσφορά**;

*(Λεπτομέρειες κάθε σημείου: §3 blockers Α/Γ, §4 Δ/Ε. Το laser/device κομμάτι Β είναι κλειστό — §3/§7.)*

---

## 1. Η ροή end-to-end (LOCKED, s45)

**Φάση Α — Μέτρηση (στον χώρο του τελικού πελάτη):**
1. **Νέο έργο** — ο τεχνικός ανοίγει έργο (work_folder).
2. **+ Άνοιγμα ή χώρος** — προσθέτει άνοιγμα (π.χ. μία πόρτα) ή ομαδοποιεί σε χώρο. Δίνει
   **τύπο** (πόρτα/παράθυρο/βιτρίνα) και **μηχανισμό** (ανοιγόμενο/συρόμενο/ανακλινόμενο/σταθερό).
3. **Κι άλλος χώρος/άνοιγμα;** — επαναλαμβάνεται (loop) για όσα κουφώματα χρειάζονται.
4. **Guided μέτρηση με laser** — για κάθε πλευρά/διάσταση: επιλέγεις πεδίο (**πλάτος → ύψος →
   βάθος κάσας**, προαιρετικά **διαγώνιος** για έλεγχο ορθογωνικότητας) → σκοπεύεις → πατάς το
   κουμπί στη συσκευή → **η τιμή έρχεται μέσω Bluetooth** → **Αποδοχή** → επόμενο πεδίο.
5. **Auto 2D σχήμα** — μόλις υπάρχουν οι διαστάσεις, **παράγεται το σχήμα του ανοίγματος**
   (parametric drawing) ανά κούφωμα — καθαρή γεωμετρία, χωρίς LiDAR.

**Φάση Β — Αίτημα προς ALUMIL (εξωτερικό):**
6. **Επιλογή ALUMIL** — dropdown: **σύστημα/σειρά** (π.χ. SMARTIA), **χρώμα/RAL**, **μηχανισμός**,
   **τζάμι/υαλοπίνακας**, εξαρτήματα, ποσότητα.
7. **AI layer → αποστολή** — τα μεταφέρει όλα (πίνακας διαστάσεων + specs + σχέδιο) στην ALUMIL
   μέσω του **per-tenant relay email** `...@opiflow.ai` με **token `[OPF-1234]`** στο θέμα.
8. **Επιστροφή προσφοράς ALUMIL** — η ALUMIL απαντά (reply στο email). Inbound webhook →
   match by token → **AI-parse της τιμής** → **ο αλουμινάς επιβεβαιώνει το ποσό** → ειδοποίηση.

**Φάση Γ — Προσφορά στον τελικό πελάτη (υπάρχον σύστημα):**
9. **Markup % + εργατικά** — ο αλουμινάς βλέπει το κόστος ALUMIL, βάζει **% πάνω** + **€ εργατικά**.
10. **Auto-προσφορά** — δημιουργείται **offer** (υπάρχον) → αποστολή/portal στον τελικό πελάτη.
11. **Αποδοχή → έργο → τιμολόγιο** — με αποδοχή προχωράει· στο τέλος **τιμολόγιο** μέσω του
    invoicing add-on (αν ενεργό).

---

## 2. Πώς πατάει πάνω στα υπάρχοντα (reuse)

Πολλά κομμάτια **υπάρχουν ήδη** — το add-on κυρίως ενώνει νέα entities με την υπάρχουσα ροή:

| Βήμα | Υπάρχον σύστημα που επαναχρησιμοποιείται |
|---|---|
| Έργο (#1, #11) | **work_folders** (η «Διαδικασία» έργου) |
| Προσφορά στον τελικό πελάτη (#10) | **offers** + **offer_response_tokens** + portal αποδοχή (#11) |
| Ειδοποιήσεις (#8) | notifications / push (offer/appointment response → push owner) |
| Τιμολόγιο (#11) | **invoicing** add-on (#436–#440): AI «τύπωσε τιμολόγιο» + auto-issue στην πληρωμή |
| AI parsing προσφοράς (#8) | Anthropic integration (ίδιο με call-brief / cmd) |

**Νέα entities/υποδομή που χρειάζονται:**
- **Per-tenant relay email** (`businesses.relay_email` ή νέος πίνακας) + **inbound email webhook**
  (matching με κρυφό token στο θέμα — βλ. blocker Γ).
- **supplier_quote_requests** — ένα αίτημα προσφοράς προς ALUMIL ανά έργο: status
  (`sent → quote_received → priced → sent_to_customer`), link στο work_folder, το email-thread token,
  τα επιλεγμένα συστήματα, η parsed τιμή + το συνημμένο.
- **alumil_systems** (catalog) — οι σειρές/συστήματα ALUMIL για το dropdown του #6
  (seeded ή API-fed — βλ. blocker Α).
- **project_openings / measurements** — ανά κούφωμα: τύπος + μηχανισμός + ποσότητα + οι μετρήσεις
  (`width_mm`, `height_mm`, `frame_depth_mm`, προαιρετικά `diagonal_mm`) + το **παραγόμενο 2D σχήμα**
  (JSON/SVG) + προαιρετικές φωτό. **(Καμία εξάρτηση από LiDAR — το σχήμα βγαίνει από τους αριθμούς.)**
- **Native Bluetooth module** (react-native-ble-plx + per-device GATT) — βλ. Blocker Β (πλέον σχεδιασμένο).

---

## 3. BLOCKERS

### ✅ Blocker Β — Laser / 3D — **ΛΥΜΕΝΟΣ (s45, sourced research)**

**Απόφαση:** Bluetooth laser (**Leica DISTO + Bosch**), **χωρίς LiDAR** στο MVP· το σχήμα βγαίνει
παραμετρικά από τις μετρήσεις.

**Ευρήματα research (τεκμηριωμένα, adversarially verified):**
- **Παίρνουμε ΕΜΕΙΣ τη μέτρηση — δεν κλειδώνεται στην app του κατασκευαστή.** Η τιμή έρχεται σαν
  απλό BLE notification (4 bytes = IEEE-754 float σε μέτρα). Χωρίς pairing-lock, χωρίς encryption.
  Το κάνουν ήδη third-party apps (magicplan, ImageMeter) + 7+ open-source projects.
- **Leica DISTO** — ανοιχτό, battle-tested GATT: service `3ab10100-f831-4395-b29d-570977d5bf94`,
  distance char `3ab10101` (float little-endian, μέτρα), command char `3ab10109`. **Ένα** πρωτόκολλο
  καλύπτει όλη τη σειρά (D1/D2/D110/X3/X4/X6). Υπάρχει και επίσημο SDK (partner program, με NDA).
  Φθηνά targets: **D1 ~€90-110**, **D2 ~€130** — ίδιο πρωτόκολλο με τα flagship. Ακρίβεια ±1 mm.
  *(Προσοχή: το **S910** πάει από WiFi, όχι BLE· τα **X4/X6** θέλουν on-device επιβεβαίωση του char —
  κάποια μοντέλα δίνουν στο `3ab1010d`. Μη hardcode-άρουμε — discover & διαλέγουμε το notifiable float.)*
- **Bosch GLM/PLR** — **επίσημο δωρεάν developer SDK** («GLM/PLR Bluetooth App Kit», MT-Protocol +
  iOS/Android demo apps) + δημόσιο GATT. Φθηνό (GLM 50-27 ~€90-110). Μειονέκτημα: UUIDs/commands
  αλλάζουν ανά μοντέλο/firmware → per-model verify.
- **Απόφυγε:** Hilti PD-C/PD-CS (standalone Android, μόνο PDF export — κλειδωμένο), Xiaomi/Hoto
  (Mi Home ecosystem), και τα φθηνά AliExpress ως «αγόρασε ό,τι θες» (κάθε SKU ≠ ίδιο πρωτόκολλο,
  κάποια είναι Bluetooth **Classic SPP** — δεν φτάνεις καν από iOS).
- **Expo/native:** `react-native-ble-plx` (npm 3.5.1, first-party Expo config plugin). Δουλεύει σε
  **Expo managed μέσω custom dev build — ΟΧΙ σε Expo Go** (χωρίς eject). iOS: `NSBluetoothAlwaysUsageDescription`
  (αλλιώς crash) + καθαρό purpose string για App Store review. Android 12+: runtime `BLUETOOTH_SCAN/CONNECT`,
  με `neverForLocation` αποφεύγουμε το location permission. Ροή: `scan (filter by service) → connect →
  discover → subscribe notify → decode 4 bytes LE float`. Effort ~2-5 μέρες/μοντέλο.
- **3D (γιατί βγήκε εκτός MVP):** iPhone LiDAR/RoomPlan/ARCore = **cm-grade, ΟΧΙ mm-grade**, και χαλάει
  ακριβώς πάνω σε **γυαλί/γυαλιστερές επιφάνειες** (= ο υαλοπίνακας). **Δεν αντικαθιστά τον laser.**
  Αν επανέλθει: iOS-only `expo-roomplan` (thin, iOS 17+, LiDAR-only) ως context/σκαρίφημα, όχι διαστάσεις.

### 🟠 Blocker Α — Κανάλι ALUMIL + ανάγνωση προσφοράς — **NARROWED (owner έχει επαφή)**
Ο owner έχει επαφή με ALUMIL. Χρειαζόμαστε **2 πράγματα** από αυτόν:
- **Α1. Κανάλι:** πώς δέχονται αιτήματα προσφοράς σήμερα — (α) email quote-desk, (β) B2B portal,
  (γ) API; Το inbound (η απάντηση) το θέλουμε email με token. Το **outbound** εξαρτάται από αυτό.
- **Α2. Catalog:** μας δίνουν λίστα **συστημάτων/σειρών + χρωμάτων/RAL + εξαρτημάτων** για το dropdown
  (#6); Και: η προσφορά τους περιλαμβάνει **τζάμια/κοπή/εξαρτήματα** ή μόνο προφίλ;
- **Α3. Μορφή προσφοράς** (PDF/Excel/free-text) → AI-parse + **human-confirm του ποσού** (υποχρεωτικό).

### 🟠 Blocker Γ — Email υποδομή — domain = **opiflow.ai**
- **Γ1.** Κατοχή/κατοχύρωση **`opiflow.ai`** + πάροχος **inbound email parsing**
  (Postmark / Mailgun Routes / SendGrid Inbound / Cloudflare Email Workers) + deliverability (SPF/DKIM/DMARC).
- **Γ2.** Matching με κρυφό **token στο θέμα** `[OPF-1234] …` (όχι όνομα έργου).
- **Γ3.** Το relay email χρησιμοποιείται **μόνο** για ALUMIL ή και για άλλη εισερχόμενη επικοινωνία;

---

## 4. Υπόλοιπα ανοιχτά ερωτήματα

### Δ. Τιμολόγηση προσφοράς (#9–#10)
- **Δ1.** Φόρμουλα: `τελική = ALUMIL_σύνολο × (1+markup%) + εργατικά`; Ή το % και πάνω στα εργατικά;
  Τα εργατικά = ένα ποσό ή ανά κούφωμα/m²;
- **Δ2.** Το #10 χρησιμοποιεί το **υπάρχον offers** σύστημα (επιβεβαιωμένο reuse).

### Ε. Μαραγκοί
- **Ε1.** Η ροή ALUMIL είναι αλουμινίου-specific. Για **μαραγκούς** τι αλλάζει; Υπάρχει αντίστοιχος
  προμηθευτής (ξύλο/κουζίνα), ή είναι απλώς **μέτρηση + παραμετρικό σχήμα + χειροκίνητη προσφορά**
  (χωρίς προμηθευτή); *(Το measurement + auto-σχήμα κομμάτι επαναχρησιμοποιείται 1:1.)*

### ΣΤ. Packaging / gating
- **ΣΤ1.** Paid add-on **€49/έτος + ΦΠΑ** (αποφασισμένο, s44), μέσω Stripe (ίδιο μοτίβο με invoicing).
  Ενεργοποίηση με πεδίο **«κλάδος/vertical»** στο business (αλουμινάς/μαραγκός).
- **ΣΤ2.** Αποκλειστικότητα ALUMIL: όλοι υποχρεωτικά ALUMIL ή επιλογή άλλου προμηθευτή;

### Ζ. Τιμολόγιο (#11)
- **Ζ1.** «Στο τέλος» = με ολοκλήρωση έργου (won) ή με την πληρωμή; (Υπάρχει ήδη auto-issue στην
  πληρωμή — επαναχρήση.)

---

## 5. Φάσεις υλοποίησης (MVP → full)

- **Φάση 0 — Vertical flag + scaffolding:** πεδίο «κλάδος» στο business· gating (€49/έτος add-on)·
  πίνακες (project_openings/measurements, supplier_quote_requests, alumil_systems) ως **additive + dormant**.
- **Φάση 1 — Μέτρηση (native BLE):** `react-native-ble-plx` + custom dev build· connect/read UI για
  **Leica DISTO** (πρώτα) **+ Bosch**· guided μέτρηση ανά πλευρά → αποθήκευση· **auto 2D σχήμα** από
  τις διαστάσεις. Χωρίς LiDAR.
- **Φάση 2 — ALUMIL relay (outbound):** per-tenant `@opiflow.ai` + dropdown συστημάτων → αποστολή
  αιτήματος (email ή API) με token στο θέμα. *(Blocker Α + Γ πρέπει να έχουν κλείσει.)*
- **Φάση 3 — ALUMIL quote (inbound):** inbound email webhook → match by token → AI parse τιμής
  (+ human confirm) → notification.
- **Φάση 4 — Pricing → Offer:** wizard markup% + εργατικά → δημιουργία **offer** (υπάρχον) →
  αποστολή/portal αποδοχή.
- **Φάση 5 — Τιμολόγιο:** σύνδεση με το invoicing add-on (won/πληρωμή → τιμολόγιο).

Κάθε φάση = δικό της PR, πράσινο (tsc/vitest/build), additive + gated → zero-Live μέχρι ενεργοποίηση.

---

## 6. Εξαρτήσεις & ρίσκα (μη-τεχνικά)

- **Συμφωνία ALUMIL** (αποκλειστικότητα + κανάλι/API/email + catalog) — εμπορικό, owner-side (έχει επαφή).
- **Domain `opiflow.ai`** + email deliverability (SPF/DKIM/DMARC) + inbound parsing provider.
- **Native Bluetooth** = dev build (όχι Expo Go), per-device verify, χρόνος QA σε φυσική συσκευή+laser.
- **AI quote parsing** = ρίσκο ακρίβειας → υποχρεωτικό human-confirm στο ποσό.
- **GDPR** = αποθήκευση μετρήσεων/σχεδίων χώρου τελικού πελάτη.

---

## 7. Laser landscape — **SOURCED (s45)**

> Έρευνα με παράλληλους web-research agents + adversarial verification (5 angles, 10 agents).
> Πλήρες output: workflow `ble-laser-measurement-research` (s45).

| Συσκευή | Πρόσβαση | Για εμάς |
|---|---|---|
| **Leica DISTO** (D1/D2/D110/X3/X4/X6) | 🟢 Ανοιχτό GATT + επίσημο SDK | **Πρωτεύον.** Ένα πρωτόκολλο, ±1mm, brand που εμπιστεύονται. Φθηνό: D1/D2. |
| **Bosch GLM/PLR** | 🟢 **Επίσημο δωρεάν SDK** | **Δευτερεύον.** Φθηνό· UUIDs ανά μοντέλο. |
| **Stabila LD** | 🟡 BLE, χωρίς docs | Δουλεύει, αλλά self-RE. |
| Φθηνά generic (Mileseey/Sndway/UNI-T) | 🟡 Per-model RE | Κάθε μοντέλο ≠ ίδιο πρωτόκολλο· κάποια Classic-SPP. |
| **Hilti PD-C/PD-CS** · Xiaomi/Hoto | 🔴 Κλειδωμένο | Απόφυγε. |
| Phone LiDAR / RoomPlan / ARCore | — | cm-grade, χαλάει σε γυαλί → **όχι για διαστάσεις**, μόνο context (post-MVP). |

**Συμπέρασμα:** ο laser δίνει τα mm (Leica primary + Bosch), το σχήμα βγαίνει από τους αριθμούς,
το LiDAR δεν χρειάζεται για το MVP.

---

## 8. Επόμενο βήμα

Blocker Β λυμένος. Για να ξεκινήσει η **Φάση 0**, ο owner:
1. Ρωτά την επαφή ALUMIL: **κανάλι** (email/portal/API) + **catalog** (Α1/Α2).
2. Κλειδώνει το **`opiflow.ai`** + inbound-email provider (Γ1).
Μετά: Φάση 0 (vertical flag + dormant scaffolding) ως πρώτο PR, και Φάση 1 (native BLE, Leica+Bosch)
που είναι πλέον πλήρως σχεδιασμένη.
