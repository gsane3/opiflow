# Opiflow — Κάθετο add-on: Αλουμινάδες & Μαραγκοί (ALUMIL integration)

> **STATUS: PLANNING / SPEC — δεν έχει ξεκινήσει.** Καταγραφή του οράματος + ανοιχτά
> ερωτήματα + προτεινόμενη αρχιτεκτονική. Ο owner θα δώσει το «go» όταν έρθει η ώρα.
> Καμία γραμμή κώδικα δεν γράφεται μέχρι να κλειδώσουν τα 3 blockers (Α/Β/Γ παρακάτω).

Τελευταία ενημέρωση: session 44 (2026-06-30).

---

## 0. Τι είναι

Ένα **industry add-on (κάθετο)** πάνω από τα base features του Opiflow, που στοχεύει
δύο κλάδους: **(1) αλουμινάδες** και **(2) μαραγκούς**. Αυτοματοποιεί όλη την αλυσίδα
από τη **μέτρηση στον χώρο** μέχρι την **προσφορά στον τελικό πελάτη** και το **τιμολόγιο**,
με **αποκλειστική συνεργασία προμηθευτή (ALUMIL)** για το αλουμίνιο.

### Ορολογία (ΚΡΙΣΙΜΟ — να μη μπερδευτεί)
- **«πελάτης» / χρήστης = ο αλουμινάς/μαραγκός** (ο συνδρομητής του Opiflow).
- **«τελικός πελάτης» = ο δικός του πελάτης** (το νοικοκυριό/η οικοδομή).
- **ALUMIL = ο προμηθευτής συστημάτων αλουμινίου** (extruder/systems house).

---

## 1. Η ροή end-to-end (όπως την έδωσε ο owner)

1. **Per-tenant email** — σε κάθε χρήστη που μπαίνει στην εφαρμογή δημιουργείται ένα email,
   π.χ. `onomaetaireias@opiflow.gr`.
2. **Δεν το χρησιμοποιεί ο ίδιος** — είναι αποκλειστικά η διεύθυνση-relay για τον αυτοματισμό
   (αποστολή προς ALUMIL + matching της απάντησης).
3. **Μέτρηση με Bluetooth laser** — ο αλουμινάς πάει στον χώρο με laser μετρητή διαστάσεων
   (συμβατό Bluetooth), και η εφαρμογή παίρνει τις μετρήσεις (+ **3D αρχεία** αν το laser/η
   συσκευή υποστηρίζει 3D generation).
4. **Αποστολή στην ALUMIL** — με το άνοιγμα νέου έργου, αφού ο αλουμινάς πάρει μέτρα (ή 3D),
   πατάει «αποστολή στην ALUMIL για προσφορά». Σε **wizard** διαλέγει το **σύστημα/συστήματα**
   ALUMIL που ενδιαφέρουν τον τελικό πελάτη. (Προϋποθέτει ότι η ALUMIL μας έχει δώσει πρόσβαση.)
5. **Επιστροφή προσφοράς ALUMIL** — η ALUMIL απαντά **ως reply στο email**, με **θέμα = όνομα
   έργου** ώστε να γίνεται matching. Φτάνει **ειδοποίηση** στον αλουμινά.
6. **Markup %** — ο αλουμινάς διαλέγει τι **% πάνω** θέλει να βάλει.
7. **Εργατικά** — ο αλουμινάς διαλέγει εργατικά.
8. **Προσφορά στον τελικό πελάτη** — σε συνέχεια wizard, φεύγει η προσφορά στον τελικό πελάτη.
9. **Αποδοχή** — με αποδοχή προσφοράς προχωράει το έργο.
10. **Τιμολόγιο** — αν ο χρήστης έχει ενεργή την τύπωση τιμολογίων, εκδίδεται τιμολόγιο μέσω
    της εφαρμογής στο τέλος.

---

## 2. Πώς πατάει πάνω στα υπάρχοντα (reuse)

Πολλά κομμάτια **υπάρχουν ήδη** — το add-on κυρίως ενώνει νέα entities με την υπάρχουσα ροή:

| Βήμα | Υπάρχον σύστημα που επαναχρησιμοποιείται |
|---|---|
| Έργο (#4, #9) | **work_folders** (η «Διαδικασία» έργου) |
| Προσφορά στον τελικό πελάτη (#8) | **offers** + **offer_response_tokens** + portal αποδοχή (#9) |
| Ειδοποιήσεις (#5) | notifications / push (offer/appointment response → push owner) |
| Τιμολόγιο (#10) | **invoicing** add-on (#436–#440): AI «τύπωσε τιμολόγιο» + auto-issue στην πληρωμή |
| AI parsing προσφοράς (#5) | Anthropic integration (ίδιο με call-brief / cmd) |

**Νέα entities/υποδομή που χρειάζονται:**
- **Per-tenant relay email** (`businesses.relay_email` ή νέος πίνακας) + **inbound email webhook**
  (matching με κρυφό token στο θέμα — βλ. blocker Γ).
- **supplier_quote_requests** — ένα αίτημα προσφοράς προς ALUMIL ανά έργο: status
  (`sent → quote_received → priced → sent_to_customer`), link στο work_folder, το email-thread token,
  τα επιλεγμένα συστήματα, η parsed τιμή + το συνημμένο.
- **alumil_systems** (catalog) — οι σειρές/συστήματα ALUMIL για τον wizard του #4
  (seeded ή API-fed — βλ. blocker Α).
- **project_measurements** — οι μετρήσεις ανά κούφωμα (πλάτος×ύψος, ποσότητα, τύπος) + προαιρετικό
  3D αρχείο στο storage.
- **Native Bluetooth module** (react-native-ble-plx + device-specific GATT/SDK) — το μεγαλύτερο
  native κομμάτι (βλ. blocker Β).

---

## 3. 🔴 BLOCKERS (ορίζουν αν είναι εφικτό σύντομα ή θέλει εξωτερικές εξαρτήσεις)

### Blocker Α — Κανάλι ALUMIL + ανάγνωση προσφοράς
- **Α1.** Κανάλι προς ALUMIL: (α) μόνο email, (β) API, (γ) portal-login στη δική μας εφαρμογή;
  Το #5 («ως απάντηση στο email») καθορίζει ότι το **inbound = email**. Το outbound;
- **Α2.** Μορφή προσφοράς ALUMIL (PDF/Excel/structured/free text) + **πώς εξάγουμε την ΤΙΜΗ**.
  *Πρόταση:* AI parsing του PDF/κειμένου, με τον αλουμινά να **επιβεβαιώνει το ποσό** πριν
  προχωρήσει (ασφάλεια έναντι λάθος τιμής → λάθος προσφορά).
- **Α3.** Catalog συστημάτων ALUMIL: το συντηρούμε εμείς ή το δίνει η ALUMIL; Η προσφορά τους
  περιλαμβάνει **και τζάμια/εξαρτήματα/κοπή** ή **μόνο προφίλ**;

### Blocker Β — Laser / 3D
- **Β1.** Στρατηγική 3D: (α) **LiDAR κινητού** (iPhone Pro + Apple RoomPlan) — δωρεάν, χωρίς
  εξωτερική συσκευή· (β) **ειδικό 3D laser** (π.χ. Leica BLK3D)· (γ) και τα δύο. Για απλές
  αποστάσεις: Bluetooth laser (Leica DISTO / Bosch GLM). Με ποια **μία** ξεκινάμε;
- **Β2.** Heads-up scope: το Bluetooth σε native app θέλει **custom native module + dev build**
  (όχι Expo Go) → σοβαρό native έργο. Αποδεκτό;
- *(Μόλις κλειδώσει η στρατηγική → σωστή **sourced deep-research** για τις συμβατές συσκευές.)*

### Blocker Γ — Email υποδομή
- **Γ1.** Έχουμε/κατοχυρώνουμε το **`opiflow.gr`**; Ποιος πάροχος **inbound email parsing**
  (Postmark / Mailgun Routes / SendGrid Inbound / Cloudflare Email Workers);
- **Γ2.** Το matching «θέμα = όνομα έργου» είναι εύθραυστο. *Πρόταση:* κρυφό token στο θέμα,
  π.χ. `[OPF-1234] Ανακαίνιση Παπαδόπουλου`, για σίγουρο matching.
- **Γ3.** Το email χρησιμοποιείται **μόνο** για ALUMIL relay ή και για άλλη εισερχόμενη επικοινωνία;

---

## 4. Υπόλοιπα ανοιχτά ερωτήματα

### Δ. Τιμολόγηση προσφοράς (#6–#8)
- **Δ1.** Φόρμουλα: `τελική = ALUMIL_σύνολο × (1+markup%) + εργατικά`; Ή το % και πάνω στα εργατικά;
  Τα εργατικά = ένα ποσό ή ανά κούφωμα/m²;
- **Δ2.** Επιβεβαίωση ότι το #8 χρησιμοποιεί το **υπάρχον offers** σύστημα.

### Ε. Μαραγκοί
- **Ε1.** Η ροή ALUMIL είναι αλουμινίου-specific. Για **μαραγκούς** τι αλλάζει; Υπάρχει αντίστοιχος
  προμηθευτής (ξύλο/κουζίνα), ή είναι απλώς **μέτρηση + χειροκίνητη προσφορά** (χωρίς προμηθευτή);

### ΣΤ. Packaging / gating
- **ΣΤ1.** Paid add-on (όπως η τιμολόγηση, μέσω Stripe) ή δωρεάν; Ενεργοποίηση με πεδίο
  **«κλάδος/vertical»** στο business (αλουμινάς/μαραγκός);
- **ΣΤ2.** Αποκλειστικότητα ALUMIL: όλοι υποχρεωτικά ALUMIL ή επιλογή άλλου προμηθευτή;

### Ζ. Τιμολόγιο (#10)
- **Ζ1.** «Στο τέλος» = με ολοκλήρωση έργου (won) ή με την πληρωμή; (Υπάρχει ήδη auto-issue στην
  πληρωμή — επαναχρήση.)

---

## 5. Προτεινόμενη φασαρία υλοποίησης (MVP → full) — *draft, αλλάζει με τις απαντήσεις*

- **Φάση 0 — Vertical flag + scaffolding:** πεδίο «κλάδος» στο business· gating του add-on·
  πίνακες (measurements, supplier_quote_requests, alumil_systems) ως **additive + dormant**.
- **Φάση 1 — Μέτρηση:** native Bluetooth capture (μία συσκευή, π.χ. Leica DISTO) → αποθήκευση
  μετρήσεων στο έργο. (Προαιρετικά: phone-LiDAR/RoomPlan 3D ως extra.)
- **Φάση 2 — ALUMIL relay (outbound):** per-tenant relay email + wizard επιλογής συστημάτων →
  αποστολή αιτήματος (email ή API) με token στο θέμα.
- **Φάση 3 — ALUMIL quote (inbound):** inbound email webhook → match by token → AI parse τιμής
  (+ human confirm) → notification.
- **Φάση 4 — Pricing → Offer:** wizard markup% + εργατικά → δημιουργία **offer** (υπάρχον) →
  αποστολή/portal αποδοχή.
- **Φάση 5 — Τιμολόγιο:** σύνδεση με το invoicing add-on (won/πληρωμή → τιμολόγιο).

Κάθε φάση = δικό της PR, πράσινο (tsc/vitest/build), additive + gated → zero-Live μέχρι ενεργοποίηση.

---

## 6. Εξαρτήσεις & ρίσκα (μη-τεχνικά)

- **Συμφωνία ALUMIL** (αποκλειστικότητα + πρόσβαση/API/email + catalog) — εμπορικό, owner-side.
- **Domain `opiflow.gr`** + email deliverability (SPF/DKIM/DMARC) + inbound parsing provider.
- **Native Bluetooth** = dev build (όχι Expo Go), per-device SDK/GATT, χρόνος QA σε φυσική συσκευή.
- **AI quote parsing** = ρίσκο ακρίβειας → υποχρεωτικό human-confirm στο ποσό.
- **GDPR / 3D αρχεία** = αποθήκευση μετρήσεων/σκαναρισμάτων χώρου τελικού πελάτη.

---

## 7. Preliminary laser landscape (ΠΡΟΧΕΙΡΟ — προς επαλήθευση με deep-research)

> Όχι sourced ακόμη — θα γίνει σωστή έρευνα μόλις κλειδώσει το Blocker Β.

- **Leica DISTO** (D2 / D110 / D510 / X3 / X4 / X6): Bluetooth (BLE), app «DISTO Plan», υπάρχει
  **SDK / DISTO transfer** → η πιο «integration-friendly» οικογένεια για 2D αποστάσεις.
- **Leica BLK3D**: handheld imager — βγάζει **3D μετρήσεις από φωτογραφία** (in-picture measuring).
  Το πιο κοντινό σε «3D generation» με ειδική συσκευή.
- **Leica DISTO X4 + DST 360** adapter → μέτρηση **3D συντεταγμένων** σημείων (indirect).
- **Bosch GLM / Zamo** (Bluetooth, app «Measuring Master») — πιο περιορισμένο SDK.
- **Phone LiDAR**: iPhone 12 Pro+ / iPad Pro με **Apple RoomPlan** (parametric 3D μοντέλο χώρου)
  & ARKit Scene Reconstruction — ο «χωρίς-εξωτερική-συσκευή» 3D δρόμος. Android: ARCore Depth
  (χωρίς dedicated LiDAR στα περισσότερα).
- **Σκέψη:** για αλουμίνιο χρειάζεται **mm-ακρίβεια** ανά κούφωμα (π×υ) → Bluetooth DISTO είναι
  ιδανικό· το 3D/RoomPlan ταιριάζει πιο πολύ για **πλαίσιο/visualization** παρά για το ίδιο το
  νούμερο της προσφοράς. Πιθανό MVP: **2D Bluetooth capture** core, **3D scan** προαιρετικό extra.

---

## 8. Επόμενο βήμα

Ο owner απαντά στα 3 blockers (Α/Β/Γ) + τα Δ–Ζ. Όπου «TBD» → προτείνω τον πιο πρακτικό δρόμο για
MVP. Μετά: Φάση 0 (vertical flag + dormant scaffolding) ως πρώτο PR.
