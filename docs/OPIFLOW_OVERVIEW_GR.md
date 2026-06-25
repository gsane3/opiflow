# Opiflow — Τεχνική Επισκόπηση (για τεχνικό επαγγελματία)

> Σκοπός αυτού του εγγράφου: να εξηγήσει **απλά αλλά πλήρως** πώς είναι στημένο το Opiflow —
> όλα τα βασικά flow, οι τεχνολογίες και οι τρίτες υπηρεσίες — ώστε ένας έμπειρος μηχανικός
> να καταλάβει το σύστημα μέσα σε μισή ώρα. Είναι θεμελιωμένο στον πραγματικό κώδικα
> (όχι θεωρητικό). Η «ζωντανή» κατάσταση του project κρατιέται στο `PROJECT_STATE.md`.
>
> **Τελευταία ενημέρωση:** 2026-06-25

---

## 1. Τι είναι το Opiflow — σε μία παράγραφο

Το Opiflow είναι ένα **mobile-first «επαγγελματικό τηλέφωνο + CRM»** για Έλληνες τεχνικούς /
μικρές υπηρεσίες (υδραυλικοί, ηλεκτρολόγοι, συνεργεία κ.λπ.). Κάθε επιχείρηση παίρνει ένα
**πραγματικό ελληνικό σταθερό νούμερο** που **χτυπάει μέσα στην εφαρμογή**. Κάθε κλήση
**ηχογραφείται** (με νόμιμη ηχητική προειδοποίηση), **απομαγνητοφωνείται** και παράγει μια
**περίληψη με AI** που μπαίνει αυτόματα στην καρτέλα του πελάτη. Γύρω από αυτό υπάρχει ένα
απλό CRM: πελάτες, «Έργα», προσφορές, ραντεβού, μηνύματα (Viber/SMS/email), και ένα
**δημόσιο portal** όπου ο πελάτης βλέπει την προσφορά του και απαντά — χωρίς login. Η χρέωση
γίνεται με **συνδρομή μέσω Stripe** (1 πακέτο, 37,14 €/μήνα με ΦΠΑ).

Είναι **όλα στα Ελληνικά** (δεν υπάρχει multi-language).

---

## 2. Η αρχιτεκτονική με μια ματιά

Υπάρχουν **τρία «πρόσωπα»** (clients) πάνω σε **έναν** κοινό backend:

```
   ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────┐
   │  Web app        │   │  Native app      │   │  Δημόσιο portal     │
   │  (browser/PWA)  │   │  (iOS + Android) │   │  πελάτη  /f/<token> │
   │  Next.js+React  │   │  Expo/React Nat. │   │  (χωρίς login)      │
   └────────┬────────┘   └────────┬─────────┘   └──────────┬──────────┘
            │   (JWT)             │  (JWT)                  │ (token στο URL)
            └──────────────┬──────┴─────────────────────────┘
                           ▼
         ┌──────────────────────────────────────────────┐
         │   Backend = Next.js API routes σε Vercel      │   ~100 endpoints
         │   (όλη η λογική + ασφάλεια ζει εδώ)            │
         └───────┬───────────────────────┬───────────────┘
                 ▼                        ▼
       ┌──────────────────┐    ┌────────────────────────────────────┐
       │  Supabase        │    │  Τηλεφωνία (ξεχωριστό «κουτί»)      │
       │  Postgres + Auth │    │  InterTelecom → Asterisk(Hetzner)  │
       │  + Storage       │    │  → Twilio → app                    │
       └──────────────────┘    └────────────────────────────────────┘
                 ▲                        ▲
                 └──── + Εξωτερικές υπηρεσίες (Stripe, Deepgram, OpenAI,
                       Anthropic, Apifon, Resend, Firebase, Sentry…) ───┘
```

**Το κλειδί για να καταλάβει κανείς το σύστημα:** ο **Next.js backend στη Vercel** είναι το
κέντρο. Όλα τα clients είναι «λεπτά» (thin) — δείχνουν δεδομένα και καλούν το ίδιο REST API.
Όλη η επιχειρηματική λογική, η ασφάλεια και οι κλήσεις προς τρίτες υπηρεσίες γίνονται στον
backend. Η **τηλεφωνία** είναι ένα ξεχωριστό, πιο «παραδοσιακό» κομμάτι υποδομής (ένας δικός
μας server με Asterisk) και είναι το **πιο εξειδικευμένο** μέρος του project.

---

## 3. Τα βασικά κομμάτια (components)

### 3.1 Web app — Next.js 16 (App Router) + React 19 + Tailwind v4
- Φιλοξενείται στη **Vercel** (`sane127/opiflow`, live: `opiflow.vercel.app`, branded host `opiflow.ai`).
- Είναι κυρίως **client-rendered**: ένα `AppShell` ελέγχει το Supabase session και δείχνει
  login / onboarding / την εφαρμογή.
- Πλοήγηση «κινητού»: 4 tabs (Αρχική, Πελάτες, Κλήσεις, Ρυθμίσεις) + ένα κουμπί AI.
- Δύο συστήματα στυλ: **Tailwind** για το owner app + ένα custom CSS (`opiflow-proto.css`)
  για την καρτέλα πελάτη και το δημόσιο portal. Brand χρώμα = **water-blue `#2A86C5`**
  (έχει «χαρτογραφηθεί» πάνω στην κλίμακα `indigo-*` του Tailwind μέσα στο `globals.css`).

### 3.2 Native app — Expo SDK 54 / React Native 0.81 (`/native`)
- **Πραγματικά native οθόνες** (όχι WebView) για όλα τα βασικά — μοιράζονται **τον ίδιο**
  backend (ίδιο Supabase + ίδιο `/api/*` της Vercel) με το web.
- Μόνο **δύο** μικρά σημεία χρησιμοποιούν WebView (η ηχογράφηση της δήλωσης κλήσης και ο AI
  μικρόφωνο-recorder), επειδή η εγγραφή ήχου στο browser είναι πιο αξιόπιστη και δεν συγκρούεται
  με το audio session του Twilio.
- Builds μέσω **EAS (Expo)** — **δεν** υπάρχει runtime CI· κάθε αλλαγή native θέλει νέο build
  και δοκιμή σε συσκευή.
- ⚠️ Στη ρίζα του repo υπάρχει και ένα **παλιό Capacitor** shell (φορτώνει το web σε WebView).
  Είναι **R&D / αρχείο**, **όχι** η εφαρμογή που κυκλοφορεί. Η ζωντανή native app είναι το Expo.

### 3.3 Backend API — ~100 Next.js Route Handlers (`src/app/api/**`)
- Δεν υπάρχει ξεχωριστός server ούτε ORM. Κάθε endpoint είναι ένα αρχείο `route.ts`
  (runtime = Node.js) που μιλάει στο Supabase.
- **Πολύ σημαντικό:** ο backend συνδέεται στη βάση με το **service-role key** του Supabase,
  που **παρακάμπτει** το Row Level Security. Άρα η **απομόνωση μεταξύ επιχειρήσεων (multi-tenant)
  γίνεται μέσα στον κώδικα**: κάθε query φιλτράρει ρητά με `business_id`. (Το RLS υπάρχει σαν
  δεύτερη γραμμή άμυνας, αλλά στην πράξη η ασφάλεια στηρίζεται στο φίλτρο του κώδικα.)
- Τρεις «πόρτες» εισόδου: (1) **authenticated** endpoints (Supabase JWT → χρήστης → επιχείρηση
  → ρόλος), (2) **δημόσια** endpoints πελάτη με **μυστικό token στο URL** (χωρίς login),
  (3) **webhooks** μηχανών (Stripe/Twilio/PBX/Apifon) που επαληθεύονται με υπογραφή/secret.

### 3.4 Βάση — Supabase (PostgreSQL) + Auth + Storage
- Μία βάση, ~**38 πίνακες**, σε **62 χειρόγραφα SQL migrations** (`supabase/migrations/001..062`).
- ⚠️ Τα migrations εφαρμόζονται **με το χέρι** στον Supabase SQL editor (όχι `supabase db push`).
  Γι' αυτό ο κώδικας είναι γραμμένος «ανθεκτικά»: αν λείπει μια καινούρια στήλη/πίνακας, η
  εφαρμογή **υποβαθμίζεται** αντί να σκάσει.
- Auth: **Supabase Auth** (email/password + **Google/Apple OAuth**).
- Storage: ιδιωτικό bucket `customer-uploads` (φωτο/βίντεο πελατών μέσω signed URLs).

### 3.5 Τηλεφωνία — InterTelecom → Asterisk (Hetzner) → Twilio → app
Το πιο σύνθετο κομμάτι (αναλυτικά στην §4.3). Σύνοψη:
- **InterTelecom** = ο Έλληνας πάροχος που δίνει τα γεωγραφικά νούμερα (DIDs) σε ένα κοινό SIP trunk.
- **Asterisk 20.6** σε **δικό μας server στη Hetzner** (`46.224.138.115`) είναι ο «κόμβος» στη
  μέση: κρατάει τη γραμμή με τον πάροχο, δρομολογεί ποια κλήση πάει σε ποια επιχείρηση,
  ηχογραφεί, και παίζει την υποχρεωτική δήλωση «η κλήση καταγράφεται».
- **Twilio Programmable Voice** είναι η γέφυρα ανάμεσα στο Asterisk και την **native** εφαρμογή
  (και κάνει το «χτύπημα» σε κλειστή app μέσω VoIP push).
- Το **web** χρησιμοποιεί **jsSIP** (WebRTC) και μιλάει κατευθείαν στο Asterisk.
- ⚠️ Η ρύθμιση (dialplan) του Asterisk **ζει μόνο στο μηχάνημα — δεν είναι στο git**. Υπάρχει
  ένα script (`scripts/provision-asterisk.py`) που παράγει τα ανά-επιχείρηση αρχεία ρύθμισης.

### 3.6 AI pipeline
- **Καταγραφή → Deepgram (απομαγνητοφώνηση, ελληνικά, με διαχωρισμό ομιλητών) → OpenAI
  (περίληψη «call brief» στα ελληνικά)**. Η OpenAI χρησιμοποιείται και ως εφεδρεία στην
  απομαγνητοφώνηση. Ο ήχος/κείμενο **δεν αποθηκεύονται** (μένουν στη μνήμη).
- **AI φωνητικός βοηθός** (`/cmd`): μιλάς ελληνικά → **Anthropic Claude (Haiku 4.5)** το
  μετατρέπει σε δομημένη «εντολή» (νέα προσφορά/ραντεβού/έργο). **Τίποτα δεν εκτελείται/στέλνεται
  χωρίς να το δεις και να το επιβεβαιώσεις** (review-first).
- ⚠️ Οι «έξυπνες» προτάσεις «Προτεινόμενη ενέργεια» και «Τι χρειάζεται τώρα» **δεν** είναι AI —
  είναι **ντετερμινιστικοί κανόνες** στον κώδικα (πιο προβλέψιμο/φθηνό). Το AI συνεισφέρει μόνο
  το κείμενο της περίληψης κλήσης.

---

## 4. Τα βασικά flows (πώς δουλεύει στην πράξη)

### 4.1 Εγγραφή → πληρωμή → ενεργοποίηση
1. Ο χρήστης φτιάχνει λογαριασμό (email/password ή Google/Apple) — **Supabase Auth**.
2. Διαλέγει το (μοναδικό) πακέτο. Δημιουργείται η «επιχείρηση» και μια συνδρομή σε κατάσταση
   `pending_payment` (**δεν** είναι ακόμη ενεργός). Του ανατίθεται αυτόματα ένα νούμερο από το
   pool (ή μπαίνει αίτημα για χειροκίνητη ανάθεση).
3. Πατάει «Πληρωμή & ενεργοποίηση» → ο server φτιάχνει μια **hosted Stripe Checkout** σελίδα και
   τον ανακατευθύνει στο `checkout.stripe.com`. (Δεν υπάρχει publishable key / Stripe.js — όλα
   είναι server-side REST με το secret key.)
4. Μετά την πληρωμή, το **Stripe webhook** (`/api/webhooks/stripe`) γυρίζει τη συνδρομή σε
   `active`. Από εκεί και πέρα ξεκλειδώνουν τα «πληρωμένα» (π.χ. tokens για κλήσεις).
5. Η διαχείριση/ακύρωση συνδρομής γίνεται μέσω του **Stripe Customer Portal**.

> Τιμή: **29,95 € + ΦΠΑ 24% = 37,14 €/μήνα** (μία πηγή αλήθειας: `src/lib/billing/plans.ts`).
> «Path B» tax-inclusive: ο ΦΠΑ είναι ενσωματωμένος, χωρίς Stripe Tax.

### 4.2 Πελάτης → «Έργο» → δημόσιο portal
1. Ο τεχνικός φτιάχνει/βρίσκει πελάτη και (προαιρετικά) ένα **«Έργο»** (folder) — η ομαδοποίηση
   μιας δουλειάς (προσφορές, ραντεβού, μηνύματα, φωτο κάτω από αυτό).
2. Το «Έργο» παράγει ένα **μυστικό link** (`/f/<token>`) που στέλνεται στον πελάτη με Viber/SMS/email.
3. Ο πελάτης ανοίγει το link **χωρίς login**: βλέπει την προσφορά, μπορεί να την **αποδεχθεί/
   απορρίψει**, να **δηλώσει κατάθεση**, να **ανεβάσει φωτο** ή να **ρωτήσει** κάτι (chat).
4. Το token είναι **τυχαίο, αποθηκεύεται κρυπτογραφημένο (SHA-256)** και κάθε δημόσια ενέργεια
   ελέγχεται «τριπλά» (επιχείρηση + έργο + κατάσταση) ώστε κανείς να μη βλέπει ξένα δεδομένα.

### 4.3 Εισερχόμενη κλήση (το «καρδιά» του προϊόντος)
1. Πελάτης καλεί το ελληνικό νούμερο της επιχείρησης.
2. **InterTelecom** παραδίδει την κλήση μέσω SIP trunk στο **Asterisk** (Hetzner).
3. Ο Asterisk **παίζει τη δήλωση** «η κλήση καταγράφεται» (υποχρεωτικό GDPR), αρχίζει **ηχογράφηση**,
   και προωθεί την κλήση μέσω **Twilio** στην εφαρμογή.
4. Το **native app χτυπάει ακόμη κι αν είναι κλειστό** χάρη στο **VoIP push** του Twilio
   (CallKit στο iOS, full-screen intent στο Android). Το **web** χτυπάει παράλληλα μέσω jsSIP.
5. Στο κλείσιμο, ο Asterisk στέλνει webhook στον backend → δημιουργείται/βρίσκεται ο πελάτης,
   καταγράφεται η κλήση (απαντημένη/αναπάντητη). Αν είναι **αναπάντητη**, φτιάχνεται task
   «κάλεσε ξανά» + ειδοποίηση, και (εκτός ωραρίου) στέλνεται αυτόματη απάντηση στον πελάτη.
6. Η ηχογράφηση → **Deepgram → OpenAI** → η περίληψη μπαίνει στην κλήση· ο ήχος **διαγράφεται**.

### 4.4 Εξερχόμενη κλήση
- Από το native, ο τεχνικός καλεί → **Twilio** (με token από τον backend) → **Asterisk** →
  **InterTelecom**, και ο πελάτης βλέπει το **νούμερο της επιχείρησης** ως caller-ID.
- Δικλίδες ασφαλείας: μόνο ελληνικοί προορισμοί επιτρέπονται, υπάρχει **ημερήσιο όριο κλήσεων**
  ανά επιχείρηση (anti-fraud), και η ηχογράφηση γίνεται μόνο αν είναι ενεργή η ρύθμιση.
- Από το **web**, το ίδιο μέσω **jsSIP** (χωρίς Twilio).

### 4.5 AI φωνητική εντολή
1. Μιλάς ελληνικά → απομαγνητοφώνηση (web: Web Speech API· native: στέλνει κλιπ στο
   `/api/ai/transcribe` → **OpenAI**).
2. Το κείμενο πάει στο `/api/ai/cmd` → **Anthropic Claude Haiku** → δομημένη «πρόθεση»
   (π.χ. «φτιάξε προσφορά»).
3. Σου δείχνει **προεπισκόπηση** για έλεγχο. Μόνο όταν επιβεβαιώσεις, καλούνται τα κανονικά API
   που γράφουν στη βάση/στέλνουν. (Το AI από μόνο του δεν γράφει/στέλνει τίποτα.)

### 4.6 Μηνύματα & ειδοποιήσεις
- **Apifon** → Viber (με αυτόματο fallback σε SMS) προς τους πελάτες (links, υπενθυμίσεις).
- **Resend** → email (π.χ. αποστολή προσφοράς).
- **Firebase Cloud Messaging / APNs** → push στις native apps (αναπάντητες κλήσεις, εβδομαδιαία
  σύνοψη κ.λπ.). *Σημείωση: αυτές είναι οι **ειδοποιήσεις** (non-call push) — δουλεύουν σε
  **Android**· στο **iOS** εκκρεμούν (θέλουν Firebase-iOS). Το «χτύπημα» των **κλήσεων** σε
  κλειστή app είναι ξεχωριστό (Twilio VoIP/CallKit) και **δουλεύει** και στο iOS και στο Android.*
- **Cron jobs** (στη Vercel, καθημερινά): προγραμματισμένα μηνύματα, υπενθυμίσεις, εβδομαδιαία σύνοψη.

---

## 5. Όλες οι τεχνολογίες (stack)

| Επίπεδο | Τεχνολογία | Ρόλος |
|---|---|---|
| Web frontend | **Next.js 16 (App Router), React 19, TypeScript** | Owner app + δημόσιο portal |
| Styling | **Tailwind CSS v4** + custom `opiflow-proto.css` | UI / brand |
| Backend | **Next.js Route Handlers** (Node runtime) | ~100 REST endpoints, όλη η λογική |
| Βάση | **Supabase / PostgreSQL** | Δεδομένα, Auth, Storage |
| Auth | **Supabase Auth** (+ Google/Apple OAuth) | Ταυτότητα χρήστη |
| Πληρωμές | **Stripe** (hosted Checkout, REST χωρίς SDK) | Συνδρομές |
| Τηλεφωνία (carrier) | **InterTelecom** (SIP trunk) | Ελληνικά νούμερα/PSTN |
| Τηλεφωνία (PBX) | **Asterisk 20.6** (chan_pjsip) σε **Hetzner VPS** | Δρομολόγηση/ηχογράφηση/δήλωση |
| Τηλεφωνία (app leg) | **Twilio Programmable Voice** (+ Voice SDK, VoIP push) | Native κλήσεις, ring-when-killed |
| Τηλεφωνία (web) | **jsSIP** (WebRTC) | Softphone στον browser |
| Apomαγνητοφώνηση | **Deepgram** (nova-2, el, diarize) | Speech-to-text |
| AI περιλήψεις/βοηθός | **OpenAI** (gpt-4o) + **Anthropic Claude** (Haiku 4.5) | Brief, εντολές, drafts |
| Μηνύματα | **Apifon** (SMS+Viber), **Resend** (email) | Επικοινωνία με πελάτη |
| Push | **Firebase Cloud Messaging / APNs** | Ειδοποιήσεις native |
| Native | **Expo SDK 54 / React Native 0.81 / expo-router** | iOS + Android app |
| Native (legacy) | **Capacitor 7** | R&D shell (όχι σε χρήση) |
| Hosting | **Vercel** (web+API), **Hetzner** (PBX), **Supabase** (DB) | Υποδομή |
| Παρακολούθηση | **Sentry** | Error monitoring |
| Rate-limit | **Upstash Redis** (προαιρετικό) | Όρια ρυθμού API |
| Builds/Stores | **EAS/Expo**, **Codemagic**, App Store Connect, Google Play | Διανομή native |
| Έλεγχος ποιότητας | **Vitest** (291 tests), `tsc`, `next build` | Local gates (χωρίς CI) |
| Source control | **GitHub** (`gsane3/opiflow`) | Κώδικας / PR-based deploy |

---

## 6. Όλες οι τρίτες υπηρεσίες (τι κάνει η καθεμία + πού ρυθμίζεται)

> Οι περισσότερες είναι **env-gated**: αν λείπει το κλειδί, το αντίστοιχο feature απλώς
> «κοιμάται» αντί να ρίξει την εφαρμογή. Παρακάτω αναφέρονται **ονόματα** μεταβλητών
> περιβάλλοντος (env vars), όχι τιμές/μυστικά.

| Υπηρεσία | Σε τι χρησιμεύει | Env / config |
|---|---|---|
| **Supabase** | Βάση (Postgres), Auth, Storage — ο πυρήνας | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` · live project `oluhmztfimmgmbxoioea` |
| **Vercel** | Hosting web+API, cron jobs | `vercel.json`, `CRON_SECRET` · project `sane127/opiflow` |
| **Stripe** | Συνδρομές (hosted Checkout + Portal + webhook) | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` (χωρίς publishable key) |
| **Twilio Voice** | Native κλήσεις, δρομολόγηση inbound/outbound, ηχογράφηση, VoIP push | `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY/SECRET`, `TWILIO_TWIML_APP_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_OUTBOUND_SIP_DOMAIN`, `TWILIO_PUSH_CREDENTIAL_SID_IOS/_ANDROID`, `OUTBOUND_ALLOWED_DEST_REGEX`, `OUTBOUND_DAILY_CALL_CAP` · region **us1** |
| **InterTelecom** | Έλληνας πάροχος γεωγραφικών DIDs (trunk IT658318) | Μόνο στο PBX (όχι app env) · 15 €/έτος/νούμερο, χωρίς API |
| **Asterisk PBX (Hetzner)** | PBX: trunk, δρομολόγηση, ηχογράφηση, δήλωση, voicemail | `PBX_WEBHOOK_SECRET`, `PBX_BUSINESS_ID`, `SIP_CRED_ENC_KEY`, `PHONE_SIP_WSS_URL/REALM/...` · host `root@46.224.138.115` |
| **Deepgram** | Απομαγνητοφώνηση κλήσεων (ελληνικά, diarize) | `DEEPGRAM_API_KEY` |
| **OpenAI** | Εφεδρική απομαγνητοφώνηση + περίληψη κλήσης + φωνητικός βοηθός | `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_BRIEF_MODEL` |
| **Anthropic (Claude)** | AI εντολές, drafts απαντήσεων, σύνοψη πελάτη | `ANTHROPIC_API_KEY` (Haiku 4.5) |
| **Apifon** | SMS + Viber προς πελάτες (+ status webhook) | `APIFON_CLIENT_ID`, `APIFON_API_KEY`, `APIFON_*_SENDER_ID`, `APIFON_WEBHOOK_SECRET` |
| **Resend** | Transactional email (προσφορές κ.λπ.) | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` |
| **Firebase Cloud Messaging** | Push σε native (Android live· iOS εκκρεμεί) | `FCM_SERVICE_ACCOUNT_JSON` ή `FCM_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` · `google-services.json` |
| **Apple APNs / PushKit / CallKit** | iOS VoIP push & οθόνη κλήσης | `app.json` entitlements · server credential εκκρεμεί |
| **Sentry** | Παρακολούθηση σφαλμάτων (live) | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| **Upstash Redis** | Durable rate-limiting (προαιρετικό) | `UPSTASH_REDIS_REST_URL/TOKEN` |
| **Hetzner Cloud** | VPS που τρέχει το Asterisk (~4,5 €/μήνα) | host only · SSH key `~/.ssh/yorgos_pbx_vps_600` |
| **EAS / Expo** | Builds + υποβολή native | `native/eas.json`, `EXPO_PUBLIC_*` |
| **Codemagic** | CI/CD για το (legacy) Capacitor | `codemagic.yaml` |
| **App Store Connect / Google Play** | Διανομή iOS/Android | `eas.json` submit · bundle `ai.opiflow.app` |
| **Google Maps** | Άνοιγμα διεύθυνσης πελάτη (μόνο deep-link, χωρίς API key) | — |
| **Telnyx** | *Αδρανές* εφεδρικό webhook παρόχου (δεν χρησιμοποιείται) | `TELNYX_WEBHOOK_*` |
| **GitHub** | Source control + PR-based deploy | repo `gsane3/opiflow` |

---

## 7. Πού «ζει» τι (χάρτης υποδομής)

| Κομμάτι | Πού τρέχει | Σημείωση |
|---|---|---|
| Web + API | **Vercel** (`sane127/opiflow`) | Auto-deploy σε merge στο `master` |
| Βάση / Auth / Storage | **Supabase** (`oluhmztfimmgmbxoioea`) | Το παλιό `hgboywgjddphzeiwtezw` είναι νεκρό |
| PBX (Asterisk) | **Hetzner VPS** `46.224.138.115` | ⚠️ Η ρύθμιση **δεν** είναι στο git |
| Πάροχος γραμμής | **InterTelecom** | 1 κοινό trunk για όλους τους tenants |
| Native builds | **EAS/Expo** (`gsane127-team`) | iOS app `6778021875`, team `7Q7A3NFK8T` |
| Κώδικας | **GitHub** `gsane3/opiflow` | Local: `E:\yorgos` |

---

## 8. Ασφάλεια & κρίσιμα σημεία (αυτά να ξέρει ο μηχανικός)

Αυτά **δεν** είναι «λάθη» — είναι σχεδιαστικές επιλογές με συνέπειες που ένας νέος μηχανικός
πρέπει να γνωρίζει από την πρώτη μέρα:

1. **Η απομόνωση μεταξύ επιχειρήσεων στηρίζεται στον κώδικα.** Ο backend χρησιμοποιεί το
   service-role key (παρακάμπτει το RLS). Αν ξεχαστεί **ένα** φίλτρο `business_id` σε ένα query,
   θα μπορούσαν να διαρρεύσουν δεδομένα άλλου πελάτη. Μετριασμός: κεντρικά helpers
   (`authenticateBusinessRequest`, token helpers) + composite foreign keys στη βάση.
2. **Το `SUPABASE_SERVICE_ROLE_KEY` είναι το «κύριο κλειδί»** όλου του συστήματος (βάση +
   storage + admin auth). Δεν πρέπει ποτέ να φτάσει στον client.
3. **Η ρύθμιση του PBX ζει μόνο στο μηχάνημα Hetzner — όχι στο git.** Αν χαθεί ο server,
   χάνεται η δρομολόγηση κλήσεων. Αυτό είναι το **#1 single point of failure** και απαιτεί
   τεκμηρίωση + backup + (ιδανικά) infrastructure-as-code.
4. **Τα DB migrations εφαρμόζονται με το χέρι.** Δεν υπάρχει αυτόματο ιστορικό «τι είναι live».
   Πιθανό drift μεταξύ git και πραγματικής βάσης (ο κώδικας το αντέχει, αλλά είναι ρίσκο).
5. **Δεν υπάρχει αυτόματο CI** — τα gates (`tsc` + 291 Vitest + `next build`) τρέχουν τοπικά
   πριν το PR. Καλό πρώτο έργο για έναν νέο μηχανικό: να μπει CI.
6. **Rate-limiting** είναι per-instance (in-memory) εκτός αν ρυθμιστεί το Upstash.
7. **iOS killed-app calls = δουλεύουν** (επιβεβαιωμένο σε production). Το ξεχωριστό εκκρεμές
   είναι το **non-call push notifications** στο iOS (expo-notifications/FCM) — θέλει ρύθμιση
   Firebase-iOS. Οι **κλήσεις** χτυπούν κανονικά (CallKit/VoIP), οι **ειδοποιήσεις** όχι ακόμη.
8. **Stripe Customer Portal** βρίσκει τον πελάτη με βάση το email (όχι αποθηκευμένο customer id)
   — εύθραυστο αν διαφέρει το email.

---

## 9. Πώς γίνεται deploy & αλλαγές

- **Ροή:** branch → αλλαγές → local gates (`npx tsc --noEmit` + `npx vitest run` + `npx next build`·
  για native `cd native && npx tsc --noEmit`) → **PR** → merge στο `master` → η Vercel κάνει
  auto-deploy. **Απευθείας push στο `master` είναι κλειδωμένο.**
- **Migrations:** copy-paste του SQL αρχείου στον **Supabase SQL editor** (όχι `db push`).
- **PBX:** αλλαγές μέσω SSH στο μηχάνημα· το `provision-asterisk.py` ξαναγράφει τα ανά-επιχείρηση
  αρχεία ρύθμισης.
- **Native:** νέο **EAS build** + δοκιμή σε πραγματική συσκευή (δεν υπάρχει runtime CI για native).
- **Μυστικά:** τα τοποθετεί ο ιδιοκτήτης (env vars σε Vercel/EAS/PBX)· δεν υπάρχουν σε plaintext
  στο repo.

---

## 10. Πού να κοιτάξει πρώτα ένας νέος μηχανικός

1. **`PROJECT_STATE.md`** — η ζωντανή «αλήθεια» του project (changelog, IDs, ανοιχτά θέματα).
2. **`AGENTS.md`** — οι βασικοί κανόνες/περιορισμοί.
3. **`src/lib/api/auth.ts`** — πώς γίνεται authentication & tenant isolation.
4. **`src/app/api/**`** — όλα τα endpoints.
5. **`supabase/migrations/*.sql`** — το data model (η μόνη πηγή για το schema).
6. **`docs/PBX_SETUP_FOR_INTERTELECOM.md`**, **`docs/CALL_RECORDING_DISCLOSURE.md`**,
   **`docs/INCOMING_CALLS_BACKGROUND.md`** — η τηλεφωνία.
7. **`docs/MVP_READINESS_AUDIT.md`** — ο τελευταίος έλεγχος ετοιμότητας.

---

## 11. Κόστη υπηρεσιών — fixed vs credit/usage (μηνιαία βάση)

> **Τι είναι αυτή η ενότητα:** αναλυτικά τα κόστη **κάθε** υπηρεσίας, χωρισμένα σε
> **σταθερό μηνιαίο (fixed)** που το πληρώνεις ό,τι κι αν γίνει, και **ανά-χρήση (credit/usage)**
> που το πληρώνεις μόνο όταν χρησιμοποιείς την υπηρεσία. **Δεν** περιέχει σενάρια χρήσης — μόνο
> τις τιμές, για να ξέρεις το **Monthly Fixed Cost** σου.
>
> **Νόμισμα & ισχύς:** όλες οι τιμές είναι **επίσημες, Ιουνίου 2026** (πηγές: οι σελίδες
> τιμολόγησης των παρόχων). Vercel / Supabase / Twilio / Deepgram / OpenAI / Anthropic / Apple /
> EAS τιμολογούν σε **USD**· Hetzner / Stripe / Apifon / InterTelecom σε **EUR**. Ενδεικτική
> ισοτιμία **€1 ≈ $1,08** (≈ $1 = €0,92). Σε EU προστίθεται **ΦΠΑ** όπου ισχύει.

### 11.1 Σταθερά μηνιαία κόστη (FIXED) — η μηνιαία σου βάση

**Α) Υποχρεωτικά (χωρίς αυτά δεν τρέχει το production):**

| Υπηρεσία | Πλάνο | Σταθερό κόστος | Σημείωση |
|---|---|---|---|
| **Vercel** | Pro | **$20 / μήνα** | Περιλαμβάνει $20 usage credit + 1 TB bandwidth + 10M edge requests → για μικρή app μένει ουσιαστικά flat. Το Hobby (δωρεάν) **απαγορεύεται** για εμπορική χρήση. |
| **Supabase** | Pro | **$25 / μήνα** | Υποχρεωτικό για production (καθημερινά backups, δεν «παγώνει» το project). Περιλαμβάνει $10 compute credit + 8 GB DB / 100 GB storage / 250 GB egress. |
| **Hetzner** (PBX VPS) | CX23 → CPX22 | **~€6 → ~€20 / μήνα** (net) | Δες σημείωση grandfather παρακάτω. Το τρέχον μηχάνημα πιθανότατα «κλειδωμένο» σε παλιά (χαμηλότερη) τιμή. + €0,50/μήνα IPv4. |
| **Apple Developer** | — | **$99 / έτος ≈ $8,25 / μήνα** | Υποχρεωτικό για App Store (ετήσιο). |
| **Domain `opiflow.ai`** | .ai | **~$82 / έτος ≈ $6,9 / μήνα** | Ετήσια ανανέωση (Porkbun· άλλοι registrars ακριβότεροι). |

> **Σύνολο υποχρεωτικού fixed ≈ $65–75 / μήνα (~€60–70 / μήνα)** — με το PBX στη χαμηλή
> (grandfathered/CX23) τιμή. Αν το PBX ξαναστηθεί σήμερα σε CPX22, πρόσθεσε ~€12/μήνα.

**Β) Προαιρετικά fixed (αυτή τη στιγμή €0 — μόνο αν αναβαθμίσεις):**

| Υπηρεσία | Δωρεάν tier | Πότε γίνεται πληρωμένο |
|---|---|---|
| **Sentry** | Developer $0 (5.000 errors/μήνα, 1 χρήστης) | Team **$29/μήνα** (50.000 errors, πολλοί χρήστες) |
| **Resend** (email) | $0 (3.000 emails/μήνα, 100/ημέρα) | Pro **$20/μήνα** (50.000 emails) |
| **Upstash Redis** | $0 (free / pay-as-you-go) | Fixed πλάνο από **$10/μήνα** (δεν χρειάζεται) |
| **Expo EAS** (builds) | $0 (15 Android + 15 iOS builds/μήνα) | Starter **$19/μήνα** ή Production **$199/μήνα** |
| **Google Play** | — | **$25 εφάπαξ** (μία φορά, όχι μηνιαίο) |

**Γ) ⚠️ Apifon (Viber) — η μεγάλη μεταβλητή:**
Το Apifon **απαιτεί μηνιαία ελάχιστη συνδρομή Viber Sender ID** για να μένει ενεργό το Viber.
**Εκτίμηση: ~€150–€300/μήνα** ανά Sender ID (από συγκρίσιμους Έλληνες παρόχους — το Apifon
**δεν δημοσιεύει τιμές**). Αν ισχύει, είναι το **μεγαλύτερο σταθερό κόστος** σου. **Επιβεβαίωσέ το
με το Apifon** (accounting@apifon.com). **Μόνο-SMS** αποφεύγει αυτό το μηνιαίο πάγιο.

### 11.2 Ανά-χρήση κόστη (CREDIT / USAGE) — $0 σταθερό, πληρώνεις ό,τι χρησιμοποιείς

| Υπηρεσία | Τι χρεώνει | Τιμή |
|---|---|---|
| **Twilio Voice** | ανά λεπτό κλήσης (ανά leg· μία κλήση ≈ 2 legs) | **~$0,004/λεπτό** ανά leg (≈ **$0,008/λεπτό** συνολικά) |
| | ηχογράφηση | **$0,0025/λεπτό** + αποθήκευση **$0,0005/λεπτό/μήνα** (πρώτα 10.000 min/μήνα δωρεάν) |
| **Deepgram** (STT) | απομαγνητοφώνηση ελληνικών + diarization | **~$0,0112/λεπτό** (Nova-3 multilingual $0,0092 + diarization $0,0020) · ~$0,67/ώρα · **$200 free credit** |
| **OpenAI** | απομαγνητοφώνηση (gpt-4o-transcribe) | **~$0,006/λεπτό** ήχου |
| | περίληψη (gpt-4o) | **$2,50** / 1M input tokens · **$10** / 1M output tokens |
| **Anthropic** (Claude Haiku 4.5) | AI εντολές / drafts / σύνοψη | **$1** / 1M input · **$5** / 1M output (cache hit $0,10/1M) → κλάσματα cent ανά μήνυμα |
| **Apifon** | Viber (παραδομένο) | **~€0,02/μήνυμα** *(εκτίμηση)* |
| | SMS (fallback) | **~€0,034–0,042/SMS** *(εκτίμηση)* |
| **Stripe** | ανά συνδρομητική χρέωση (EEA κάρτα) | **1,5% + €0,25** (κάρτα) **+ 0,7%** (Billing) = **~2,2% + €0,25** → ~**€1,07** σε χρέωση €37,14 |
| | UK / διεθνείς κάρτες | 2,5% / 3,25% + €0,25 (+2% αν χρειαστεί μετατροπή νομίσματος) |
| **InterTelecom** | ανά νούμερο πελάτη | **~€15/έτος ≈ €1,25/μήνα** ανά ενεργό νούμερο (geographic-only, χωρίς API)· *μηνιαίο trunk fee: επιβεβαίωσε με τον πάροχο* |
| **Resend** (πάνω από free) | επιπλέον emails | $0,90 / 1.000 emails |
| **Upstash** (αν χρησιμοποιηθεί) | εντολές Redis | $0,20 / 100K commands |
| **Sentry** (πάνω από free) | επιπλέον σφάλματα | ~$0,36 / 1.000 errors |

### 11.3 Δωρεάν / χωρίς κόστος

- **Firebase Cloud Messaging / APNs** (push) — δωρεάν.
- **Google Maps** (μόνο deep-links, χωρίς API key) — δωρεάν.
- **GitHub** — δωρεάν στην τρέχουσα χρήση.
- **Codemagic** — free tier 500 λεπτά build/μήνα (μόνο για το legacy Capacitor).
- **Telnyx** — αδρανές, $0.

### 11.4 Σημαντικές σημειώσεις

- **Hetzner grandfathering:** στις 15/6/2026 η Hetzner αύξησε σημαντικά τη σειρά AMD (CPX):
  CPX22 €7,99 → **€19,49**/μήνα (net). Τα **ήδη ανοιχτά** μηχανήματα κρατούν την παλιά τιμή
  εφόσον **δεν** γίνει rescale. Άρα αν το PBX στήθηκε πριν, πληρώνεις την παλιά (χαμηλή) τιμή —
  μέχρι να το πειράξεις. Φθηνότερη ισοδύναμη επιλογή σήμερα: **CX23 ~€5,49/μήνα** (net).
- **Apifon:** οι τιμές Viber/SMS και το μηνιαίο minimum είναι **εκτιμήσεις** — το Apifon δεν
  δημοσιεύει τιμοκατάλογο. **Πρέπει** να επιβεβαιωθούν πριν κλειδώσεις το cost model.
- **Stripe:** το 0,7% Billing **προστίθεται** πάνω στο 1,5% της κάρτας (δεν περιλαμβάνεται).
  Δεν είναι «κόστος που πληρώνεις» — αφαιρείται από κάθε είσπραξη.
- **AI/φωνή/STT/email/Sentry/Upstash = όλα $0 σταθερό** (pay-as-you-go). Το πραγματικό σου
  **πάγιο** είναι μικρό: Vercel + Supabase + Hetzner + Apple + domain (+ **πιθανώς** Apifon Viber).
