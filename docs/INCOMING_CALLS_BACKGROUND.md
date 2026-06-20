# Εισερχόμενες κλήσεις με κλειστή/κλειδωμένη εφαρμογή (VoIP push)

Στόχος: το app να **χτυπάει** όταν είναι κλειστό ή κλειδωμένο, χωρίς να «τρέχει μόνιμα στο background». Αυτό ΔΕΝ γίνεται κρατώντας το app ζωντανό — γίνεται με **VoIP push** (PushKit στο iOS, FCM data push στο Android) που ξυπνάει το app τη στιγμή της κλήσης. Το Twilio Voice SDK + CallKit (iOS) / ConnectionService (Android) δείχνουν την οθόνη κλήσης ακόμη κι αν το app είναι σκοτωμένο.

## Τι φταίει αν δεν χτυπάει κλειστό (η συνηθισμένη αιτία)

Το access token που παίρνει η συσκευή πρέπει να κουβαλάει ένα **Push Credential** για τη συγκεκριμένη πλατφόρμα. Αν λείπει, η συσκευή «γράφεται» κανονικά αλλά το Twilio **δεν στέλνει push** όταν έρχεται κλήση → κλειστό app = δεν χτυπάει (ό,τι κι αν κάνει ο κώδικας).

- **Android FCM credential:** ρυθμισμένο (s27, `TWILIO_PUSH_CREDENTIAL_SID_ANDROID`).
- **iOS APNs VoIP credential:** **πρέπει να ρυθμιστεί** → `TWILIO_PUSH_CREDENTIAL_SID_IOS`. Μέχρι τότε, σε iPhone οι κλήσεις ΔΕΝ χτυπούν με κλειστό app.

Η εφαρμογή πλέον το **δείχνει**: μετά τη σύνδεση, αν λείπει το push credential, εμφανίζεται κίτρινη ειδοποίηση στην Αρχική («Οι κλήσεις δεν θα χτυπούν με κλειστή εφαρμογή…»). Το `/api/phone/twilio-token` επιστρέφει `pushConfigured: true|false` (μόνο boolean — ποτέ το SID).

## Owner steps για iOS (μία φορά)

1. **Apple Developer → Certificates, Identifiers & Profiles → Keys → +**
   - Δημιούργησε ένα **APNs key** (`.p8`) με ενεργό το **Apple Push Notifications service (VoIP)** (ή χρησιμοποίησε APNs Auth Key). Σημείωσε Key ID + Team ID + κατέβασε το `.p8`.
2. **Twilio Console → Voice → Push Credentials → Create new Credential → Apple Push Notification service (VoIP)**
   - Ανέβασε το `.p8`, βάλε **Production** (το app έχει `aps-environment: production`), Key ID, Team ID, Bundle ID `ai.opiflow.app`.
   - Κράτα το **Credential SID** (`CRxxxx…`).
3. **Vercel (project `sane127/opiflow`) → Settings → Environment Variables**
   - Πρόσθεσε `TWILIO_PUSH_CREDENTIAL_SID_IOS = CRxxxx…` → **Redeploy**.
4. **Στη συσκευή:** άνοιξε το app μία φορά (logged in) ώστε να ξανα-γραφτεί με το νέο credential. Η κίτρινη ειδοποίηση πρέπει να φύγει.

## Πώς το επαληθεύεις

1. iPhone με νέο build (TestFlight), logged in, **κλείδωσε/σκότωσε** το app.
2. Κάλεσε το DID της επιχείρησης από άλλο τηλέφωνο.
3. Πρέπει να χτυπήσει η οθόνη κλήσης (CallKit) με Απάντηση/Απόρριψη.
4. Αναπάντητη → εμφανίζεται στις **Αναπάντητες** (πλέον καταγράφεται και client-side).

## Τι διορθώθηκε στον κώδικα (αυτό το PR)

- **Αναπάντητες καταγράφονται:** όταν μια εισερχόμενη ακυρώνεται/λήγει, ο client κάνει log `status:'missed'` (`/api/calls/log` δέχεται πλέον `missed`). Πριν, χανόταν τελείως.
- **Stale «ringing» όταν ανοίγεις το app:** μια ξεπερασμένη πρόσκληση (το push ήρθε ενώ ήμασταν σκοτωμένοι) **αυτο-κλείνει** μετά το παράθυρο κλήσης (35s) και καταγράφεται ως αναπάντητη· αν πατήσεις «Απάντηση» σε νεκρή πρόσκληση, καθαρίζει + καταγράφεται αναπάντητη αντί να «κολλάει».
- **Re-register σε κάθε foreground** όταν η συσκευή δεν είναι «registered» (όχι μόνο μετά από error) ώστε να μένει δεκτική σε κλήσεις.
- **Διάγνωση push:** η Αρχική προειδοποιεί όταν λείπει το push credential.

> Όλη η υποδομή (UIBackgroundModes voip+audio, aps-environment, η VoiceGrant με pushCredentialSid, το inbound TwiML `<Dial><Client>`) υπάρχει ήδη. Μένει **μόνο** το βήμα 1–4 παραπάνω για iOS.
