# Voicemail → text (F7) — Asterisk setup

The server side is **ready and inert**: `POST /api/webhooks/voice/pbx-voicemail`
accepts a voicemail WAV, transcribes it with the existing Deepgram→OpenAI
pipeline, writes the Greek text onto the customer timeline (status `missed`,
summary `Φωνητικό μήνυμα: …`), and pushes the owner. It is **not active** until
the Asterisk dialplan is wired to record + upload a voicemail.

## What the owner needs to do (on the PBX, `root@46.224.138.115`)

In the inbound dialplan, **after** the `Dial(...)` to the app fails (NOANSWER/
BUSY), play a short Greek prompt, record a message, then upload it. Example
(adapt to the existing `from-intertelecom` context):

```asterisk
; ... after the Dial() that rings the app/owner and returns no answer ...
 exten => s,n,Playback(opiflow-leave-message)      ; «Αφήστε μήνυμα μετά τον ήχο»
 exten => s,n,Set(VM_FILE=/tmp/vm-${UNIQUEID})
 exten => s,n,Record(${VM_FILE}.wav,5,120)          ; up to 120s, stop after 5s silence
 exten => s,n,System(/usr/local/bin/opiflow-vm-upload.sh "${VM_FILE}.wav" "${CALLERID(num)}" "${UNIQUEID}")
 exten => s,n,Hangup()
```

Upload helper `/usr/local/bin/opiflow-vm-upload.sh` (chmod +x):

```bash
#!/usr/bin/env bash
WAV="$1"; CALLER="$2"; UNIQUEID="$3"
[ -f "$WAV" ] || exit 0
curl -s -X POST "https://www.opiflow.ai/api/webhooks/voice/pbx-voicemail" \
  -H "x-pbx-webhook-secret: $PBX_WEBHOOK_SECRET" \
  -F "audio=@${WAV};type=audio/wav" \
  -F "caller=${CALLER}" \
  -F "uniqueid=${UNIQUEID}" >/dev/null
rm -f "$WAV"      # audio is transcribed in RAM server-side; don't keep it on the PBX
```

Set `PBX_WEBHOOK_SECRET` in the script's environment to the same value used by
the existing `pbx-recording` webhook (already configured on the PBX).

## Notes
- Uses the SAME `PBX_WEBHOOK_SECRET` + `PBX_BUSINESS_ID` env as the recording
  webhook — no new server env needed.
- If the caller leaves no message, just `Hangup()` without recording — the
  missed-call funnel (task + push + after-hours auto-reply) already fired.
- The voicemail enriches the existing missed-call timeline row when the
  `uniqueid` matches; otherwise it creates a dedicated voicemail entry.
- Per the project's privacy posture, the WAV is transcribed in RAM and never
  stored; delete it on the PBX after upload (the helper does `rm -f`).
