# Call-recording disclosure greeting — Asterisk setup

Play a short Greek message — **«Η κλήση καταγράφεται για την καλύτερη εξυπηρέτησή
σας»** — to the customer on **every inbound call** and at the **start of every
outbound call**, for all users. This is a one-time PBX/Asterisk change on
`root@46.224.138.115` (the dialplan is **not** in this repo; it lives on the box).

> Why it matters: recording a call without disclosure is not GDPR-compliant in
> Greece/EU. This greeting is the disclosure. Keep it BEFORE the conversation is
> connected so consent is given up front.

## 1. Generate the audio (Greek, 8 kHz mono — Asterisk format)

**Option A — natural voice (gTTS, needs internet on the PBX):**
```bash
pip3 install --quiet gTTS
python3 - <<'PY'
from gtts import gTTS
gTTS('Η κλήση καταγράφεται για την καλύτερη εξυπηρέτησή σας.', lang='el').save('/tmp/rec.mp3')
PY
ffmpeg -y -i /tmp/rec.mp3 -ar 8000 -ac 1 -acodec pcm_s16le \
  /var/lib/asterisk/sounds/opiflow-call-recorded.wav
chown asterisk:asterisk /var/lib/asterisk/sounds/opiflow-call-recorded.wav
rm -f /tmp/rec.mp3
```

**Option B — offline (espeak-ng, robotic):**
```bash
apt-get install -y espeak-ng ffmpeg
espeak-ng -v el -s 150 "Η κλήση καταγράφεται για την καλύτερη εξυπηρέτησή σας." -w /tmp/rec.wav
ffmpeg -y -i /tmp/rec.wav -ar 8000 -ac 1 -acodec pcm_s16le \
  /var/lib/asterisk/sounds/opiflow-call-recorded.wav
chown asterisk:asterisk /var/lib/asterisk/sounds/opiflow-call-recorded.wav
rm -f /tmp/rec.wav
```

> Best quality: record a human voice and convert it with the same `ffmpeg` line.
> Verify Asterisk can read it: `asterisk -rx "file convert /var/lib/asterisk/sounds/opiflow-call-recorded.wav /tmp/t.gsm"` (should say "Converted ...").

## 2. Dialplan changes (`/etc/asterisk/extensions.conf`)

**Back up first:**
```bash
cp /etc/asterisk/extensions.conf /etc/asterisk/extensions.conf.$(date +%F-%H%M).bak
```

### Inbound — the customer is the CALLER, so play it to them before connecting
In the inbound context (`from-intertelecom`, the same one the voicemail/missed-call
funnel uses), **after `Answer()` and before the `Dial(...)`** that rings the
app/owner:
```asterisk
; from-intertelecom — after the business endpoint is resolved, before Dial():
 exten => s,n,Answer()
 exten => s,n,Wait(0.4)
 exten => s,n,Playback(opiflow-call-recorded)   ; disclosure to the caller (customer)
 ; ... existing Dial(...) to the app/owner stays unchanged ...
```

### Outbound — the customer is the CALLEE, so play it to them on answer
Add the `A(...)` Dial option to the outbound `Dial()` (technician → customer). `A(x)`
plays the announcement **to the answering party** (the customer) the moment they
pick up, before the legs are bridged:
```asterisk
; before:  exten => _X.,n,Dial(SIP/intertelecom/${EXTEN},45,...)
; after:   exten => _X.,n,Dial(SIP/intertelecom/${EXTEN},45,...A(opiflow-call-recorded))
```
(If the `Dial` already has options, just append `A(opiflow-call-recorded)` to them —
options are concatenated, e.g. `tA(opiflow-call-recorded)`.)

> Use `Playback` (non-interruptible) for the inbound disclosure so it can't be
> skipped. `A()` on outbound is inherently played in full before bridging.

## 3. Apply + verify (non-disruptive)
```bash
asterisk -rx "dialplan reload"
asterisk -rx "dialplan show from-intertelecom" | grep -i playback   # confirm it's loaded
```
Then make one **test inbound** call and one **test outbound** call and confirm you
hear the message once, before the conversation connects.

## 4. Rollback
```bash
cp /etc/asterisk/extensions.conf.<TIMESTAMP>.bak /etc/asterisk/extensions.conf
asterisk -rx "dialplan reload"
```

## Notes
- Multi-tenant: the greeting is global (same file for all businesses) — no per-biz
  config needed. It plays once per call leg.
- It does not affect the existing recording/transcription pipeline, the missed-call
  funnel, or voicemail — it only adds a Playback/announcement before bridging.
- If you later want a per-business greeting, gate the `Playback` on a channel
  variable set during business-endpoint resolution.
