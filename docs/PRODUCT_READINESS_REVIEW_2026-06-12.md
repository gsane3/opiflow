# Opiflow — End-to-End Product-Readiness Review (2026-06-12)

Πλήρες review από την εγγραφή χρήστη μέχρι το τελικό αποτέλεσμα (web + native).
Μεθοδολογία: 7 παράλληλοι AI reviewers ανά διάσταση + adversarial verification κάθε
σοβαρού ευρήματος πάνω στον πραγματικό κώδικα. Οι διαστάσεις τηλεφωνία/native/performance
ελέγχθηκαν σε βάθος με verification· security/εγγραφή/CRM/product καλύφθηκαν με
στοχευμένο inline έλεγχο (μέτριο βάθος).

**Στόχος προϊόντος (ιδιοκτήτης):** ελαφρύ, απλό στη χρήση, αποδοτικό — να ρίχνει τον
χρόνο των task σε μικρές/μεσαίες επιχειρήσεις.

---

## Συνολική εικόνα

| Διάσταση | Βαθμός | Κρίση |
|---|---|---|
| Τηλεφωνία (η «καρδιά») | 4/10 | Στέρεος πυρήνας, αλλά 2 P0 security + το «αναπάντητη κλήση = τίποτα» |
| Native app | 6/10 | Τα δύσκολα λυμένα (CallKit, briefs, UI)· λείπει το error-handling layer |
| Performance / «ελαφρύ» | 5.5/10 | Όχι βαριά δεδομένα — βαριά **waterfalls** (round-trips) |
| Security web API | ~7.5/10 (spot-check) | Tokens/webhooks/RLS/cron σωστά· τα P0 είναι στην τηλεφωνία |
| Εγγραφή → onboarding | ~7/10 (μέτριο βάθος) | Ροή πλήρης (OAuth, confirm, wizard, number pending state) |
| Product completeness | ~6/10 | Billing/email/monitoring χτισμένα αλλά ΣΒΗΣΤΑ· νεκρές σελίδες |

**Ετυμηγορία:** Το web CRM είναι κοντά σε product-ready. Η απόσταση μέχρι «πρώτοι
πληρωμένοι πελάτες» είναι κυρίως: (α) 3 P0, (β) το missed-call funnel (η στιγμή που ο
υδραυλικός χρειάζεται το προϊόν περισσότερο σήμερα δίνει: σιωπή στον πελάτη, τίποτα
actionable στον ιδιοκτήτη), (γ) 3 env vars που ανάβουν έτοιμες λειτουργίες.

---

## P0 — πριν από δεύτερο tenant / χρέωση

### 1. Κοινό SIP credential σε όλους τους tenants (fallback)
`src/app/api/phone/browser-token/route.ts:176` — Το Mode A (per-user) είναι πλέον ενεργό
(SIP_CRED_ENC_KEY set, `sipPerUser:true` στο /api/health), **αλλά** όποιο business δεν
έχει per-user row στο `browser_sip_endpoints` πέφτει σιωπηλά στο Mode B και παίρνει το
κοινό `PHONE_SIP_USERNAME/PASSWORD` (yorgospro001) σε plaintext στον browser. Ο δεύτερος
tenant θα μπορεί να σηκώσει τις κλήσεις του πρώτου από οποιοδήποτε SIP client.
**Fix:** τρέξε τον provisioner (scripts/provision-asterisk.py) για κάθε business· κάνε το
Mode B να αρνείται όταν υπάρχουν >1 businesses (ή πίσω από flag `PHONE_SIP_SHARED_OK=1`).
*(Verified: high confidence.)*

### 2. Toll-fraud: ανεξέλεγκτες εξερχόμενες για κάθε self-signup
`src/app/api/phone/twilio-token/route.ts:36` + `webhooks/voice/twilio/outbound/route.ts:103`.
Το twilio-token ελέγχει ΜΟΝΟ authentication (όχι αριθμό/συνδρομή — αντίθετα από το
browser-token), και το outbound webhook καλεί ό,τι στείλει ο client: χωρίς allowlist
προορισμών, χωρίς `<Dial timeLimit>`, χωρίς ημερήσιο όριο. Ανοιχτό signup ⇒ οποιοσδήποτε
δρομολογεί διεθνείς/premium κλήσεις μέσω του trunk σου (InterTelecom) με δική σου χρέωση.
**Fix:** ίδια gates με browser-token στο token· allowlist (default `^\+?30`), timeLimit,
ημερήσιος μετρητής ανά business στο webhook. *(Verified: high confidence.)*

### 3. Native: ο API client αγνοεί τελείως τα HTTP errors
`native/src/lib/api.ts:17` — `request()` δεν κοιτάει ποτέ `res.ok`· κάθε 401/500 γίνεται
`{}`. Συνέπειες-κλάση: ψεύτικα «αποθηκεύτηκε ✓», κενές οθόνες αντί για σφάλμα, ληγμένο
session = «άδειο CRM» χωρίς δρόμο επιστροφής στο login, και (πιθανό) Settings που
φορτώνει άδεια φόρμα μετά από failure και μπορεί να **σβήσει το προφίλ** με ένα save.
**Fix:** `if (!res.ok) throw new ApiError(status, body)` + global 401 → sign-out/login
+ error states στα screens (το pattern υπάρχει ήδη στο customers/index).
Μαζί: timeout 8-10s με AbortController (P2 σήμερα, ίδιο αρχείο).

### 3β. Branding του binary
Το app ακόμα δείχνει template icon/splash (assets: expo-badge, react-logo, tutorial-web
παραμένουν· splash/adaptiveIcon background = παλιό μπλε `#146EB4` αντί brand `#2563EB`,
`native/app.json:27`). Μπλοκάρει οποιοδήποτε customer-facing install. **Fix:** brand
icon + splash στο ίδιο PR, σβήσε τα template assets.

---

## P1 — πριν το πεις «προϊόν» (όλα verified εκτός όπου σημειώνεται)

**Τηλεφωνία — το missed-call funnel είναι άδειο (το σημαντικότερο μη-security εύρημα):**
1. **Αναπάντητη κλήση ⇒ τίποτα actionable.** Το PBX webhook γράφει μόνο label
   «Αναπάντητη κλήση» στο summary ΚΑΙ καταχωρεί τη γραμμή με `status:'completed'`
   (`pbx/route.ts:414,433`) — άρα ΟΛΑ τα missed-call UI (καμπανάκι «Χαμένη κλήση»,
   web «Κλήση πίσω», κόκκινο «αναπάντητη» στο native) δεν ανάβουν ποτέ. Ούτε task,
   ούτε push. **Fix:** στο notAnswered branch: `status:'missed'` + task call_back +
   `sendPushToBusinessOwner` (όλα τα helpers υπάρχουν).
2. **Κανένα voicemail / after-hours.** Ο καλών ακούει 30s κουδούνισμα → σιωπή/κλείσιμο
   (`twilio/inbound/route.ts:92`, χωρίς action URL· και το Asterisk dialplan Dial→Hangup).
   Το presence/telephony_mode αποθηκεύονται αλλά ΔΕΝ τα διαβάζει κανένα routing path
   (νεκροί διακόπτες). **Fix:** voicemail στο Asterisk leg → υπάρχον pipeline
   transcribeAndBriefCallAudio → brief + task (όχι Twilio `<Record>`, θα χαλούσε το
   DIALSTATUS του missed-call logging).
3. **Αποτυχία transcription = οριστική και αόρατη.** Μία αποτυχία Deepgram/OpenAI (ή
   λείπον OPENAI_API_KEY, ή αποτυχία ΜΟΝΟ του brief μετά από επιτυχές transcript) ⇒
   το brief χάνεται για πάντα: audio RAM-only, HTTP 200 στο VPS, κανείς δεν διαβάζει
   `processing_failed_at`, και παρακάμπτει το Sentry. **Fix:** jobs table (migration 030,
   ήδη υπάρχει, αχρησιμοποίητη) + retry cron· κράτα το WAV στο VPS μέχρι 2xx.
4. **Race: recording webhook vs client-side call log.** Native outbound log γίνεται από
   τον client μετά το hangup (+ το /api/calls/log περιμένει 6s LLM brief πριν το insert)·
   αν το recording callback προλάβει, το webhook ACKάρει 200 «communication_not_found»
   και το brief χάνεται (Twilio ΔΕΝ ξαναστέλνει σε 2xx — ούτε σε 4xx/5xx by default).
   **Fix:** persist unmatched CallSid+RecordingUrl και reconcile· μακροπρόθεσμα log
   server-side από το outbound TwiML.
5. **Διπλή ηχογράφηση + αιώνια διατήρηση στο Twilio cloud.** Inbound ηχογραφείται και
   από PBX και από Twilio (`record-from-answer-dual`) — διπλό κόστος· και ΚΑΝΕΝΑ
   recording δεν διαγράφεται ποτέ από το Twilio, ενώ ο κώδικας δηλώνει «RAM-only» και
   σφραγίζει `audio_discarded_at`. GDPR πρόβλημα + cost leak. **Fix:** ένας recorder ανά
   σκέλος (drop το record από inbound TwiML)· DELETE Recordings/{Sid} μετά από επιτυχή
   επεξεργασία ΚΑΙ στα no-match paths.
6. **Android inbound νεκρό by construction** — `platform=ios` hardcoded
   (`native/src/lib/twilio.ts:18`)· λανθάνον μέχρι να βγει Android, αλλά θα επιμείνει
   σιωπηλά και όταν στηθεί FCM. **Fix:** `Platform.OS` + server `ready:false` όταν λείπει
   το credential της πλατφόρμας.

**Native αξιοπιστία:**
7. **Registration εισερχομένων: σιωπηλή αποτυχία, κανένα retry.** Μόνο trigger το cold
   launch + χειροκίνητο κουμπί στις Ρυθμίσεις· καμία επανεγγραφή σε AppState
   active/network regain· το state το βλέπει μόνο το Settings poll. **Fix:** retry με
   backoff, re-register on foreground, κόκκινο tappable banner στην Αρχική όταν error.
8. **Το chat timeline (κορυφαία οθόνη) δεν ανανεώνεται** — ούτε pull-to-refresh ούτε
   refetch-on-focus· ακόμα και αλλαγές από τη σελίδα Πληροφοριών δεν φαίνονται στο pop
   back. **Fix:** useFocusEffect refetch + RefreshControl (και ιδανικά realtime).
9. **Create→notify ροές αναφέρουν λάθος αποτυλεσμα** (ραντεβού/προσφορά): αν αποτύχει
   μόνο το notify, ο χρήστης βλέπει «δεν δημιουργήθηκε» ενώ δημιουργήθηκε ⇒ διπλές
   εγγραφές/αποστολές στο retry. **Fix:** χώρισε τα try/catch, διαφορετικά μηνύματα.
   *(Μη-verified από agent — επιβεβαιωμένο pattern στο index.tsx:417.)*

**Config/Ops (γρήγορα, μεγάλο impact):**
10. **`vercel.json` ΧΩΡΙΣ `crons`** ⇒ το intake-reminder δεν τρέχει ποτέ — οι πελάτες
    που αγνοούν το πρώτο SMS δεν ξαναειδοποιούνται. **Fix:** `"crons":[{"path":"/api/cron/intake-reminder","schedule":"0 * * * *"}]` + CRON_SECRET.
11. **Χτισμένα αλλά ΣΒΗΣΤΑ (από /api/health):** `email:false` (λείπει RESEND_API_KEY +
    EMAIL_FROM — τα intake/upload/offer emails δεν φεύγουν), `monitoring:false` (λείπει
    SENTRY_DSN — κανένα error visibility στην παραγωγή), `billing:false` (λείπει
    STRIPE_SECRET_KEY — δεν μπορείς να χρεώσεις· task B4 #59 εκκρεμεί).
12. **Twilio voice webhooks fail OPEN χωρίς TWILIO_AUTH_TOKEN** (validation μόνο μέσα σε
    `if (authToken)`) — αντίθετα από το recording webhook που 503άρει. Σήμερα το token
    είναι set, αλλά κάνε το fail-closed. (P2→ασφάλεια-υγιεινή.)

---

## Το «ελαφρύ» — πού χάνεται η ταχύτητα (waterfalls, όχι όγκος)

Μετρημένα στον κώδικα (run 1, μη-verified αλλά συγκεκριμένα):
- **Άνοιγμα καρτέλας πελάτη ≈ 17 round-trips**: το timeline endpoint τρέχει 9 σειριακά
  queries + 2 auth queries· κάθε API call ξανακάνει getUser + membership query.
- **Dashboard ≈ 30+ round-trips**: το AppShell ξαναφορτώνει `/api/businesses/me` (5
  σειριακά queries) σε ΚΑΘΕ navigation· το /api/notifications τρέχει 9 σειριακά (τα 5
  πρώτα ανεξάρτητα → Promise.all ⇒ 3 στάδια).
- **Gallery = ο χειρότερος**: thumbnails κατεβάζουν τα FULL-SIZE πρωτότυπα φωτογραφιών
  μέσα από signed-url ένα-ένα — 20 φωτό ≈ 10+ δευτερόλεπτα και δεκάδες MB σε mobile data.
  **Fix:** Supabase image transform (240px) + batch signed-urls. (S effort, μεγάλο κέρδος.)
- **crm_number/offer_number: O(n) σε κάθε create** — κατεβάζουν ΟΛΕΣ τις γραμμές του
  business και κάνουν Math.max σε JS (+ race διπλών αριθμών). **Fix:** atomic counter στο
  businesses row.
- **Υπερ-φόρτωση λιστών**: λίστες offers σερβίρουν items+viber_draft+email_body, οι
  κλήσεις πλήρη briefs ×100· dashboard/native-home φέρνουν 300 πλήρη records για 6 νούμερα
  και 5 γραμμές. **Fix:** lightweight `/api/dashboard` (counts + 5 πρόσφατα) ή `?fields=summary`.
- **100-record caps που αλλοιώνουν δεδομένα**: το phone-match του native («Σύνδεση με
  υπάρχουσα») και τα stats της Αρχικής κοιτούν μόνο τα πρώτα 100 — μετά τους 100 πελάτες,
  διπλοεγγραφές πελατών και λάθος νούμερα. **Fix:** server-side `?q=<phone>` + counts.
- **Mega client components**: legacy customer page 3.852 γραμμές (συνυπάρχει με τη νέα
  Messenger chat), calls 2.141, cmd 1.470 (ορφανό — ΔΕΝ λινκάρεται από πουθενά).
  **Fix:** dynamic import στα modals· σβήσε legacy page + cmd μετά από επιβεβαίωση parity.
- Native: catalog autosuggest χωρίς debounce (1 Vercel invocation/πληκτρολόγηση)·
  search χωρίς cancellation (stale overwrite)· recents δεν ανανεώνονται μετά από κλήση.

**Δομικές προτάσεις:** (1) `/api/bootstrap` — ένα request: business + counts + 5 πρόσφατα
+ notifications· (2) stale-while-revalidate cache (AsyncStorage/localStorage) ώστε κάθε
άνοιγμα να δείχνει αμέσως περιεχόμενο· (3) μετά το fix των P1, μετρήσιμος στόχος:
**άνοιγμα καρτέλας < 1s σε 4G**.

---

## Τι είναι ήδη στέρεο (να μην ξαναγίνει δουλειά εδώ)

- **Token links**: 256-bit random, sha256-hashed at rest, με expiry — intake/upload/offer/
  appointment/team-invite όλα σωστά. Rate limiting υπάρχει στα public endpoints.
- **Webhooks**: apifon/recording/cron fail-closed με timing-safe σύγκριση· Stripe με
  constructEvent· admin routes με ADMIN_USER_ID guard· 37/62 routes στον κοινό auth
  helper και τα υπόλοιπα έχουν δικό τους auth (ελέγχθηκαν δειγματοληπτικά: ai/*,
  number-requests, phone-pool, businesses/me — όλα σωστά).
- **RLS**: migrations 028 + 034 (defense in depth) — η δουλειά του B2 φαίνεται.
- **Native εισερχόμενες ΔΟΥΛΕΥΟΥΝ** — το αρχικό εύρημα «το CallInvite είναι stub»
  ΚΑΤΑΡΡΙΦΘΗΚΕ στο verification: το CallKit answer/mute/hangup γίνεται στο native layer
  του SDK, και η γραμμή CRM έρχεται από το PBX webhook (by design — ένα native log θα
  δημιουργούσε διπλή εγγραφή).
- **Brief pipeline design**: idempotent PBX webhook (event_id), audit timestamps,
  fallbacks. Web nav 4 tabs — σωστά λιτό για την persona.

---

## Features που ρίχνουν χρόνο (ranked για τον υδραυλικό/ηλεκτρολόγο)

**S effort — άμεσα:**
1. **Missed-call push + one-tap callback** — «Αναπάντητη: Παπαδόπουλος» → tap → dialer.
   Όλα τα building blocks υπάρχουν (push helper, PBX dialstatus, customer match).
2. **DND διακόπτης που πραγματικά δρομολογεί** — το presence ήδη αποθηκεύεται· ο
   τεχνίτης κάτω από νεροχύτη γυρνάει 1 διακόπτη και κάθε κλήση πάει voicemail/SMS.
3. **Native date/time picker στο ραντεβού** (αντί free-text «15-06-2026») — από ~30s
   πληκτρολόγηση σε 3 taps, εξαφανίζει και τα invalid dates (το dmyToYmd δέχεται 31-02).
4. **«Νέος πελάτης» στο tab Πελάτες** — σήμερα επαφή φτιάχνεται ΜΟΝΟ από κλήση.
5. **Thumbnails 240px στο gallery** (το S με το μεγαλύτερο αισθητό κέρδος).
6. **Κλήση + Πλοήγηση πάνω στις κάρτες ραντεβού της Αρχικής** (σήμερα 3 οθόνες).

**M effort — τα δομικά:**
7. **Auto-SMS σε αναπάντητες με intake link** — «Θα σας καλέσουμε σύντομα — πείτε μας τι
   χρειάζεστε: <link>». Μετατρέπει χαμένες κλήσεις σε δομημένα jobs με φωτογραφίες όσο
   αυτός τελειώνει την τρέχουσα δουλειά. Πιθανότατα το πιο διαφοροποιό feature.
8. **Voicemail → 2-γραμμο ελληνικό brief + draft task** (μέσω υπάρχοντος pipeline).
9. **Push όταν «κάθεται» το brief** + realtime εμφάνιση στο ανοιχτό chat.
10. **Offline cache** πελατών + σημερινών tasks (υπόγεια/λεβητοστάσια χωρίς σήμα).
11. **`/api/bootstrap`** + SWR cache (η αίσθηση «ελαφρύ» περισσότερο από οτιδήποτε άλλο).
12. **Jobs-based brief pipeline** (αξιοπιστία της βασικής υπόσχεσης).

---

## Προτεινόμενο πλάνο

**Sprint 1 — «Ασφάλεια & ρεύμα» (τα γρήγορα):**
P0 #1 (gate Mode B + provisioner), P0 #2 (gates/allowlist/timeLimit/quota), P0 #3
(api.ts res.ok + 401→login + error states), branding icon/splash, vercel.json crons,
SENTRY_DSN + RESEND_API_KEY + (όταν αποφασιστεί τιμολόγηση) Stripe envs.

**Sprint 2 — «Καμία χαμένη κλήση» (το product promise):**
missed → status 'missed' + task + push (P1.1), voicemail→brief (P1.2), auto-SMS intake
(feature 7), transcription μέσω jobs + retry (P1.3), recording race fix (P1.4), διπλή
ηχογράφηση + Twilio deletion (P1.5), registration retry + banner (P1.7).

**Sprint 3 — «Ταχύτητα & λείανση»:**
/api/bootstrap + Promise.all στα notifications/timeline, thumbnails, SWR/offline cache,
σβήσιμο legacy customer page + cmd, native P2 λίστα (timeout, login copy, video lightbox,
date picker, Νέος πελάτης, recents refresh, accessibility labels).

**Μετά:** Stripe checkout (#59), Android push (FCM credential + Platform.OS), store
submission, νομικός έλεγχος privacy/terms (ιδίως ενημέρωση ηχογράφησης κλήσεων στην
Ελλάδα — τα κείμενα είναι 58/61 γραμμές, λεπτά για προϊόν που ηχογραφεί).

---

## Παράρτημα — P2 αξιοσημείωτα (συντομογραφία)

- PBX auto-create: 'anonymous' caller IDs φτιάχνουν ghost πελάτη που «μαζεύει» όλους
  τους ανώνυμους· normalizePhone να επιστρέφει null σε μη-E.164.
- Recording endpoints χωρίς idempotency — retries διπλασιάζουν ai_draft tasks/κόστος.
- Inbound browser-answered κλήσεις διπλο-καταγράφονται (PBX row + review-save row).
- Push tokens: κανένα 90-day sweep· το logout δεν κάνει unregister.
- Supabase auto-refresh: λείπει το AppState start/stopAutoRefresh wiring στο native.
- Stat cards → `'/customers/index' as never` — πιθανό Unmatched Route· χρησιμοποίησε
  `'/customers'` και σβήσε τα casts.
- Search: leading-wildcard ilike ×5 στήλες — πρόσθεσε pg_trgm όταν πλησιάσεις ~5k πελάτες.
- Native: login λέει «λάθος κωδικός» και όταν απλά δεν υπάρχει internet· video tiles
  ανοίγουν Image-only lightbox (μαύρη οθόνη)· χωρίς KeyboardAvoidingView στα Settings.
- In-call: χωρίς speaker toggle και DTMF (IVR «πατήστε 1» αδύνατο) — το SDK τα έχει.

*Πλήρη verified verdicts (με αιτιολόγηση refute-attempts) στα workflow outputs του
session 16.*
