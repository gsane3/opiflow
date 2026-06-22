# Opiflow — Τηλεφωνικό setup (για τον τεχνικό InterTelecom)

Πλήρης εικόνα του PBX μας (ό,τι θα βλέπατε σε interface). Πάροχος SIP trunk: **InterTelecom**,
trunk **IT658318**. Σκοπός: AI business-phone — οι κλήσεις περνούν από Asterisk → Twilio Voice
SDK (mobile app), με ηχογράφηση/transcription.

> Παρακάτω τα passwords είναι **<REDACTED>** (τα SIP credentials του IT658318 τα έχετε εσείς).

---

## 1. Στοιχεία υποδομής

| | |
|---|---|
| Server (PBX) | **46.224.138.115** (Hetzner, Ubuntu 24.04) |
| Asterisk | **20.6.0**, chan_pjsip (PJSIP) |
| SIP transport | **UDP**, `0.0.0.0:5060` (external signaling/media = 46.224.138.115) |
| InterTelecom SIP server | `sip.intertelecom.gr` → **146.120.226.3** |
| Trunk account | **IT658318** (register προς sip.intertelecom.gr) |
| Registration | **Registered** (expiration 120s, qualify 60s) — επιβεβαιωμένο |
| Codecs | **alaw, ulaw** (G.711) |

---

## 2. Αρχιτεκτονική / ροή κλήσεων

```
ΕΙΣΕΡΧΟΜΕΝΗ (κλήση προς 2104400811):
  Καλών (PSTN) → InterTelecom → [SIP trunk IT658318, UDP 5060]
     → Asterisk (context from-intertelecom)
     → match DID 2104400811 → endpoint χρήστη (biz_…)
     → Answer + μήνυμα ηχογράφησης + MixMonitor (record)
     → Dial προς Twilio SIP Domain (opiflow.sip.us1.twilio.com)
     → Twilio Voice SDK → χτυπάει το mobile app

ΕΞΕΡΧΟΜΕΝΗ (από το app):
  App → Twilio → [Twilio SIP → Asterisk, context from-twilio]
     → Dial PJSIP/<προορισμός>@intertelecom (UDP 5060)
     → CLI του πελάτη μέσω P-Asserted-Identity / Remote-Party-ID
```

---

## 3. PJSIP trunk προς InterTelecom (verbatim)

```ini
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0:5060
external_signaling_address=46.224.138.115
external_media_address=46.224.138.115
local_net=10.0.0.0/8

[intertelecom-reg]
type=registration
transport=transport-udp
server_uri=sip:sip.intertelecom.gr
client_uri=sip:IT658318@sip.intertelecom.gr
contact_user=IT658318
outbound_auth=intertelecom-auth
expiration=120
retry_interval=30
forbidden_retry_interval=60

[intertelecom-auth]
type=auth
auth_type=userpass
username=IT658318
password=<REDACTED>

[intertelecom-aor]
type=aor
contact=sip:IT658318@sip.intertelecom.gr
qualify_frequency=60

[intertelecom]
type=endpoint
transport=transport-udp
context=from-intertelecom
disallow=all
allow=alaw
allow=ulaw
aors=intertelecom-aor
outbound_auth=intertelecom-auth
direct_media=no
rewrite_contact=yes
rtp_symmetric=yes
force_rport=yes
from_domain=sip.intertelecom.gr
from_user=IT658318
send_pai=yes
send_rpid=yes
trust_id_outbound=yes

[intertelecom-identify]
type=identify
endpoint=intertelecom
match=146.120.226.3
```

---

## 4. Εισερχόμενες — dialplan (πώς δρομολογείται μια κλήση προς DID)

Κάθε εισερχόμενη από το trunk μπαίνει στο context **`from-intertelecom`**. Δρομολογούμε
**αποκλειστικά με βάση τον καλούμενο DID** (δεν κοιτάμε caller / Diversion):

```asterisk
[from-intertelecom]
; οποιοσδήποτε DID -> αναζήτηση στον πίνακα DID (opiflow-inbound)
exten => _.,1,NoOp(Inbound DID=${EXTEN} from ${CALLERID(num)})
 same => n,Set(OPIFLOW_DID=${EXTEN})
 same => n,GotoIf($["${DIALPLAN_EXISTS(opiflow-inbound,${EXTEN},1)}"="1"]?opiflow-inbound,${EXTEN},1)
 same => n,Goto(s,1)

; κοινή ροή: answer -> μήνυμα ηχογράφησης -> record -> dial στην app μέσω Twilio
exten => s,1,Answer()
 same => n,Wait(1)
 same => n,Playback(<μήνυμα ηχογράφησης>)
 same => n,MixMonitor(<recording>.wav)
 same => n,Dial(PJSIP/${OPIFLOW_EP}@twilio-inbound & PJSIP/yorgospro001 & PJSIP/groundwire001, 30)
 same => n,Hangup()
```

**Πίνακας DID (opiflow-inbound):**
```asterisk
[opiflow-inbound]
exten => 2104400811,1,Set(OPIFLOW_EP=biz_44892a77cce34a268e3d13c99071b413)
 same => n,Goto(from-intertelecom,s,1)
exten => 302104400811,1,Set(OPIFLOW_EP=biz_44892a77cce34a268e3d13c99071b413)
 same => n,Goto(from-intertelecom,s,1)
```

**Endpoint προς Twilio (app):**
```ini
[twilio-inbound-aor]
type=aor
contact=sip:opiflow.sip.us1.twilio.com:5060
[twilio-inbound]
type=endpoint
context=from-twilio
aors=twilio-inbound-aor
allow=ulaw,alaw
direct_media=no
```

➡️ **Σημαντικό:** δεχόμαστε την κλήση όπως κι αν φτάσει στον DID 2104400811 — **δεν** έχουμε κανέναν
περιορισμό σε Diversion/RDNIS ή στον καλούντα. Αν μια **εκτροπημένη** (call-forwarded) κλήση φτάσει στο
trunk με called number = 2104400811, δρομολογείται **ακριβώς όπως μια απευθείας κλήση**.

---

## 5. Εξερχόμενες — dialplan + CLI

```asterisk
[from-twilio]
exten => _+30XXXXXXXXXX,1,NoOp(Outbound to ${EXTEN} CLI=${CALLERID(num)})
 same => n,Dial(PJSIP/${EXTEN}@intertelecom,60,rA(<μήνυμα ηχογράφησης>))
 same => n,Hangup()
; (+ παραλλαγές για 30XXXXXXXXXX και [26]XXXXXXXXX)
```

- Ο **παρουσιαζόμενος αριθμός (CLI)** μπαίνει στο `CALLERID(num)` και αποστέλλεται μέσω
  **P-Asserted-Identity + Remote-Party-ID** (`send_pai=yes`, `send_rpid=yes`, `trust_id_outbound=yes`).
- Το **From header user = IT658318** (`from_user=IT658318`) για authentication του trunk.

---

## 6. 🔴 Δύο σημεία προς διερεύνηση (αυτά ψάχνουμε)

### Α) Εισερχόμενες μέσω ΕΚΤΡΟΠΗΣ κινητού → 2104400811
- Απευθείας κλήση στο **2104400811 → δουλεύει** (χτυπάει η app, επιβεβαιωμένο, υπάρχουν CDR).
- Με **εκτροπή** από κινητό (`**21*2104400811#`) → ο καλών ακούει **«ο αριθμός δεν χρησιμοποιείται»**,
  η κλήση **δεν φτάνει στο trunk μας**.
- **Ερώτημα:** Δέχεται το 2104400811 **forwarded κλήσεις** (CFU) από κινητά άλλων παρόχων; Χρειάζεται
  κάτι από τη δική σας πλευρά (π.χ. αποδοχή Diversion/RDNIS, ρύθμιση interconnection); Σε ποια μορφή
  πρέπει να δηλώνεται ο προορισμός εκτροπής (εθνική 2104400811 / 0030… / +30…);

### Β) Εξερχόμενο CLI εμφανίζεται ως «S»
- Στις εξερχόμενες στέλνουμε **κανονικό αριθμητικό CLI** στο PAI/RPID (το επιβεβαιώνουν τα CDR μας:
  `clid "302104400811" <302104400811>`). Δεν στέλνουμε «s».
- Ο τεχνικός σας ανέφερε ότι βλέπει «S».
- **Ερωτήματα:** (1) Έχει ενεργοποιηθεί το **SMS εξουσιοδότησης εμφάνισης αριθμού** για το CLI; (2) Το CLI
  το θέλετε στο **From header (user)** ή αρκεί το **PAI/RPID** (τώρα στέλνουμε From=IT658318 + PAI/RPID=CLI);
  (3) Σε **E.164 με `+` (`+30…`)** ή χωρίς; — όποια μορφή θέλετε, την αλλάζουμε άμεσα.

---

## 7. Πρόσβαση για διάγνωση
Αν χρειάζεστε **SIP trace**: μπορούμε να σας στείλουμε **`.pcap`** (Wireshark) μιας δοκιμαστικής κλήσης,
ή να δώσουμε προσωρινή read-only πρόσβαση στο Asterisk CLI. Πείτε μας τι προτιμάτε.

*Έγγραφο: docs/PBX_SETUP_FOR_INTERTELECOM.md*
