# Twilio Android — να χτυπάει το κινητό σε εισερχόμενη κλήση (newbie guide)

**Τι πετυχαίνεις:** όταν κάποιος καλεί το νούμερο της επιχείρησης, να **χτυπάει η
εφαρμογή στο Android** (ακόμη κι αν είναι κλειστή), με την οθόνη κλήσης (Απάντηση/
Απόρριψη) που είναι ήδη φτιαγμένη.

**Τι ΔΕΝ χρειάζεται αλλαγή:** ο κώδικας είναι έτοιμος. Οι εξερχόμενες κλήσεις ήδη
δουλεύουν, άρα τα βασικά Twilio κλειδιά υπάρχουν. **Λείπει ΜΟΝΟ ένα πράγμα:** ένα
«FCM Push Credential» στο Twilio + 1 μεταβλητή στο Vercel. ~15 λεπτά.

> Όλα γίνονται σε ιστοσελίδες (Firebase, Twilio, Vercel). Δεν χρειάζεται κώδικας.

---

## Μέρος Α — Firebase: πάρε το κλειδί FCM (JSON)

1. Πήγαινε <https://console.firebase.google.com> → άνοιξε το project **`opiflowai`**.
2. Πάνω αριστερά πάτα το **⚙ (γρανάζι) → Project settings**.
3. Καρτέλα **Service accounts**.
4. Πάτα **Generate new private key** → **Generate key**. Κατεβαίνει ένα αρχείο
   `.json` (π.χ. `opiflowai-firebase-adminsdk-xxxx.json`). **Κράτησέ το** — θα το
   ανεβάσεις στο Twilio στο επόμενο βήμα. ⚠️ Μην το ανεβάσεις πουθενά αλλού / στο git.

*(Αυτό είναι το «FCM v1» κλειδί που λέει στο Twilio πώς να σπρώχνει την κλήση στο Android.)*

---

## Μέρος Β — Twilio: φτιάξε το Push Credential

1. Πήγαινε <https://console.twilio.com> (το ίδιο account που κάνει ήδη τις κλήσεις).
2. Αναζήτησε/άνοιξε **Voice → Manage → Push Credentials** (ή γράψε «Push Credentials»
   στο search πάνω).
3. Πάτα **Create new Credential**.
4. **Friendly name:** `Opiflow Android FCM` (ό,τι θες).
5. **Type:** διάλεξε **FCM**.
6. Στο πεδίο του κλειδιού **άνοιξε το `.json` του Μέρους Α με Notepad, αντίγραψε ΟΛΟ
   το περιεχόμενο** και επικόλλησέ το εκεί (ή ανέβασε το αρχείο, αν το ζητά).
7. **Create**. Θα εμφανιστεί ένα **Credential SID** που αρχίζει με **`CR...`**
   (π.χ. `CR0123abc...`). **Αντίγραψέ το.**

---

## Μέρος Γ — Vercel: βάλε τη μεταβλητή

1. Πήγαινε <https://vercel.com> → project **`opiflow`** → **Settings → Environment Variables**.
2. **Add New**:
   - **Key:** `TWILIO_PUSH_CREDENTIAL_SID_ANDROID`
   - **Value:** το `CR...` που αντέγραψες
   - **Environment:** ✅ Production (βάλε και Preview αν θες)
3. **Save.**
4. **Σημαντικό — redeploy:** Deployments → το πιο πρόσφατο → μενού «···» → **Redeploy**
   (οι μεταβλητές «πιάνουν» μόνο σε νέο deploy).

> Tip: αν έχεις μόνο Android (όχι iPhone), μπορείς εναλλακτικά να το βάλεις και ως
> `TWILIO_PUSH_CREDENTIAL_SID` — ο κώδικας πέφτει σ' αυτό αν λείπει το per-platform.

---

## Μέρος Δ — Νέο build & δοκιμή

1. Φτιάξε νέο Android build (φέρνει ΚΑΙ όλο το νέο design + την οθόνη κλήσης):
   ```bash
   cd native
   EAS_NO_UPDATE_NOTIFIER=1 eas build -p android --profile preview   # APK για sideload/τεστ
   ```
2. Εγκατέστησέ το στο κινητό, κάνε login, **κλείσε εντελώς την εφαρμογή**.
3. Κάλεσε το νούμερο της επιχείρησης από άλλο τηλέφωνο → πρέπει να **χτυπήσει** με την
   οθόνη Απάντηση/Απόρριψη.

---

## Αν ΔΕΝ χτυπήσει — τι να κοιτάξεις

- **Έγινε redeploy** μετά τη μεταβλητή; (πιο συχνό λάθος.)
- Στο Twilio **το Credential είναι FCM** (όχι APNs) και το SID μπήκε σωστά;
- Το κινητό έχει **άδεια ειδοποιήσεων** για την app (Android Settings → Apps → Opiflow → Notifications);
- Δοκίμασε με την app **ανοιχτή** πρώτα — αν χτυπά ανοιχτή αλλά όχι κλειστή, είναι θέμα push credential/άδειας.
- (Τεχνικό, ήδη ρυθμισμένο στον κώδικα: όλα τα Twilio resources είναι στο region
  **us1** — μην αλλάξεις region στο Twilio.)

Όταν τελειώσεις, πες μου «έγινε» και επιβεβαιώνουμε μαζί.
