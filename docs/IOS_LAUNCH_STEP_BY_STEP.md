# Opiflow iOS → TestFlight — οδηγός βήμα-βήμα (newbie)

> Έτοιμη λίστα για μόλις **εγκριθεί ο λογαριασμός Apple Developer**. Όλος ο κώδικας
> είναι ήδη έτοιμος (plugin `@capacitor-firebase/messaging`, `codemagic.yaml`
> `ios-release` με τα native patches). Bundle id παντού: **`ai.opiflow.app`**.
> Firebase project: **`opiflowai`**. Codemagic integration name (στο yaml): **`opiflow_asc`**.

Τα βήματα 2–9 γίνονται **μετά** το email έγκρισης. Όπου λέει «κλειδί .p8» → το βάζεις
**μόνος σου** στο dashboard, ποτέ δεν το στέλνεις σε κανέναν.

---

## 1. ✅ Apple Developer ($99/χρόνο) — ΕΓΙΝΕ
Πληρωμένο, αναμονή έγκρισης (~24-48ω). Όταν έρθει το email «You're all set», συνέχισε.

## 2. App Store Connect API key (για το Codemagic να υπογράφει + ανεβάζει)
- https://appstoreconnect.apple.com → **Users and Access → Integrations → App Store Connect API**
- **+** (Generate API Key) → όνομα `codemagic` → ρόλος **App Manager** → Generate
- Σημείωσε το **Issuer ID** + το **Key ID**, και **κατέβασε το `.p8`** (κατεβαίνει **μόνο μία φορά** — φύλαξέ το)

## 3. Σύνδεσε το key στο Codemagic
- codemagic.io → **Teams / Team settings → Team integrations → Developer Portal (Apple)** → Add key
- **Όνομα: ΑΚΡΙΒΩΣ `opiflow_asc`** (πρέπει να ταιριάζει με το `codemagic.yaml`)
- Βάλε Issuer ID, Key ID, και ανέβασε το `.p8`

## 4. Καταχώρισε το App ID με Push
- developer.apple.com → **Certificates, Identifiers & Profiles → Identifiers → +** → App IDs → App → **Explicit**
- Bundle ID: **`ai.opiflow.app`** → στις Capabilities **τσέκαρε «Push Notifications»** → Register

## 5. Δημιούργησε το app record (απαραίτητο πριν το TestFlight)
- App Store Connect → **Apps → + → New App**
- Platform: iOS · Name: **Opiflow** · γλώσσα: Ελληνικά (ή Αγγλικά) · Bundle ID: **`ai.opiflow.app`** · SKU: `opiflow-001` · Full Access
- (Δεν χρειάζονται screenshots/περιγραφή για TestFlight internal.)

## 6. APNs Auth Key (.p8) → Firebase (για να φτάνει το push στο iPhone)
- developer.apple.com → **Keys → +** → όνομα `Opiflow APNs` → τσέκαρε **Apple Push Notifications service (APNs)** → Register → **κατέβασε το `.p8`** (μία φορά)
- Σημείωσε το **Key ID** + το **Team ID** (πάνω δεξιά στο portal)
- Firebase console → project **`opiflowai`** → ⚙️ **Project settings → Cloud Messaging → Apple app configuration → APNs Authentication Key → Upload** → ανέβασε το `.p8`, βάλε Key ID + Team ID
> ⚠️ Αυτό είναι **διαφορετικό** `.p8` από το βήμα 2.

## 7. iOS app στο Firebase → `GoogleService-Info.plist`
- Firebase `opiflowai` → **Add app → iOS** → Apple bundle ID **`ai.opiflow.app`** → Register → **κατέβασε `GoogleService-Info.plist`**
- Μετάτρεψέ το σε **base64** και βάλ' το στο Codemagic ως **Environment variable** `GOOGLE_SERVICE_INFO_PLIST` (στο workflow `ios-release`).
  - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("GoogleService-Info.plist")) | Set-Clipboard`
  - (Το `codemagic.yaml` το αποκωδικοποιεί + το καταχωρεί στο Xcode target αυτόματα.)

## 8. TestFlight internal group
- App Store Connect → το app → **TestFlight → Internal Testing** → φτιάξε group → πρόσθεσε **τον εαυτό σου** ως tester (ως κάτοχος λογαριασμού επιτρέπεσαι — **χωρίς App Review**).

## 9. Χτίσε & ανέβασε
- Codemagic → **Start new build** → branch `master` → workflow **«Opiflow iOS (release .ipa)»** → Start
- Χτίζει `.ipa` και (λόγω `submit_to_testflight: true`) ανεβαίνει στο App Store Connect. Περίμενε ~15-40' (build + «Processing»).
- 📱 Στο iPhone: εγκατέστησε την εφαρμογή **TestFlight**, άνοιξε το invite, εγκατέστησε το **Opiflow**, κάνε **login**, **Allow** στις ειδοποιήσεις.
- **Ρυθμίσεις → «🔔 Δοκιμή ειδοποίησης»** → θα δεις την ειδοποίηση στο iPhone σου. 🎉

---

## Σημειώσεις / παγίδες
- **Bundle id** πρέπει να είναι `ai.opiflow.app` σε 3 σημεία: Apple App ID, Firebase iOS app, `capacitor.config.json` (ήδη ταιριάζουν).
- Το push **δεν** δοκιμάζεται σε iOS Simulator — μόνο σε **πραγματικό iPhone** μέσω TestFlight.
- Guideline **4.2** (web-wrapper) αφορά **μόνο** δημόσια κυκλοφορία / external TestFlight — το **internal** TestFlight **δεν** περνά review.
- Παλιά «νεκρά» tokens στο `device_push_tokens` καθαρίζονται μόνα τους (ο server κλαδεύει UNREGISTERED).
- Το iOS build μπορεί να θέλει 1-2 επαναλήψεις (όπως το Android) — στείλε μου το log αν βγει κόκκινο.
