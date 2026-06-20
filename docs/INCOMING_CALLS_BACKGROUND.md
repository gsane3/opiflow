# Εισερχόμενες κλήσεις με κλειστή/κλειδωμένη εφαρμογή (VoIP push)

Στόχος: το app να **χτυπάει** όταν είναι κλειστό ή κλειδωμένο, χωρίς να «τρέχει μόνιμα στο background». Αυτό γίνεται με **VoIP push** (PushKit στο iOS, FCM data push στο Android) που ξυπνάει το app τη στιγμή της κλήσης. Το Twilio Voice SDK + CallKit (iOS) / ConnectionService (Android) δείχνουν την οθόνη κλήσης ακόμη κι αν το app είναι σκοτωμένο.

## Κατάσταση credentials (ΟΚ)

- **Android FCM credential** (`TWILIO_PUSH_CREDENTIAL_SID_ANDROID`): ρυθμισμένο (s27).
- **iOS APNs VoIP credential** (`TWILIO_PUSH_CREDENTIAL_SID_IOS`): **ρυθμισμένο** στο Vercel (Production+Preview, από 10 Ιουν — επιβεβαιωμένο από τον owner s31). Το `/api/phone/twilio-token` το επιστρέφει ως `pushConfigured:true` για iOS.

Άρα το credential **δεν** είναι η αιτία.

## Η πραγματική αιτία στον κώδικα (διορθώθηκε s31)

Το `@twilio/voice-react-native-sdk` **δημιουργεί το `PKPushRegistry` ΜΟΝΟ όταν το JS καλέσει `initializePushRegistry()`** — δεν στήνεται στο native `init()` του module (επιβεβαιωμένο από τον πηγαίο κώδικα του SDK, `ios/TwilioVoiceReactNative.m`). Στον δικό μας κώδικα η κλήση ήταν **πίσω από το login** (μέσα στο `registerForIncoming`, μετά από auth + dynamic import) → έτρεχε πολύ **αργά**.

Αποτέλεσμα σε **σκοτωμένο** app: το iOS ξυπνάει το app για το VoIP push, αλλά το registry δεν είναι έτοιμο εγκαίρως → το push «κρατιέται» και η κλήση εμφανίζεται ως **ξεπερασμένο «χτυπάει»** μόνο όταν ανοίξεις χειροκίνητα το app (ακριβώς το σύμπτωμα που περιγράφηκε).

**Fix (s31):** το `initPushRegistry()` καλείται πλέον **πολύ νωρίς στο launch και ΑΝΕΞΑΡΤΗΤΑ από το login** (`native/src/app/_layout.tsx`), ώστε το PushKit registry + CallKit να είναι έτοιμα όταν το iOS ξυπνά το σκοτωμένο app. Το token binding (`registerForIncoming`) συνεχίζει μετά το login. Χρειάζεται **νέο build** (≥ iOS build 26) + δοκιμή σε συσκευή.

## Πώς το επαληθεύεις (νέο build)

1. Εγκατέστησε το **νέο** TestFlight build, **κάνε login μία φορά** (για να γραφτεί το token), μετά **κλείδωσε/σκότωσε** το app.
2. Κάλεσε το DID της επιχείρησης από άλλο τηλέφωνο.
3. Πρέπει να χτυπήσει η οθόνη CallKit (Απάντηση/Απόρριψη) στο lock screen.
4. Αναπάντητη → εμφανίζεται στις **Αναπάντητες** (καταγράφεται και client-side, s31).

## Αν ΣΥΝΕΧΙΖΕΙ να μην χτυπάει κλειστό μετά το νέο build

Έλεγξε με τη σειρά (owner/Twilio-side):

1. **Twilio Push Credential environment.** Στο Twilio Console → Voice → Push Credentials, το APNs (VoIP) credential πρέπει να είναι **Production** (το app έχει `aps-environment: production`· το TestFlight χρησιμοποιεί production APNs). Αν είναι σημειωμένο ως **Sandbox**, το push απορρίπτεται σιωπηλά.
2. **Bundle ID** του credential = `ai.opiflow.app`.
3. **Twilio region.** Όλα (SIP Domain, push credential) πρέπει να είναι **us1** — το token route κάνει pin `region us1` (twr). Αν το push credential είναι σε άλλο region, το registration δεν ταιριάζει.
4. **Expo SDK 54 compat.** Το SDK (`2.0.0-preview.2`) δηλώνει επίσημα δοκιμασμένο με Expo 52· εμείς είμαστε σε 54. Αν μετά τα 1–3 πάλι δεν δουλεύει, η εφεδρική λύση είναι config plugin που στήνει το PushKit στο native `AppDelegate.didFinishLaunching` (πριν φορτώσει το JS) — δες το SDK doc «applications-own-pushkit-handler».

## Τι διορθώθηκε στον κώδικα (s31)

- **Early PushKit init** (το παραπάνω) — η βασική διόρθωση για ring-when-killed.
- **Αναπάντητες καταγράφονται** client-side (`/api/calls/log` δέχεται `status:'missed'`).
- **Stale «ringing»** auto-κλείνει μετά 35s + log missed· «Απάντηση» σε νεκρή πρόσκληση καθαρίζει αντί να κολλάει· idempotent accept/reject (double-tap safe).
- **Re-register σε κάθε foreground** όταν δεν είναι registered.
- **Διάγνωση push:** το token route επιστρέφει `pushConfigured`· η Αρχική προειδοποιεί όταν λείπει (δεν θα εμφανίζεται πια αφού το iOS credential είναι σετ).

> Η υπόλοιπη υποδομή (UIBackgroundModes voip+audio, aps-environment, VoiceGrant pushCredentialSid+incomingAllow, inbound TwiML `<Dial><Client>`) υπάρχει ήδη.
