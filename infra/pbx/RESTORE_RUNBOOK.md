# PBX disaster-recovery runbook

Goal: bring call routing back from a total loss of the Hetzner box. Target: **~30 min**.

## 0. Prerequisites (have these ready, off-box)
- Hetzner account + SSH key (`~/.ssh/yorgos_pbx_vps_600`).
- The Ansible Vault password (holds `SIP_CRED_ENC_KEY`, `PBX_WEBHOOK_SECRET`, the
  InterTelecom trunk password).
- Access to the InterTelecom portal/contact (to re-point the trunk to the new IP).
- Access to Twilio (to update the SIP Domain / `TWILIO_OUTBOUND_SIP_DOMAIN`).
- A current copy of the base Asterisk config (see "Keep a backup" below).

## 1. New server
```bash
# create a Hetzner CX23 (Ubuntu 24.04), note its IP
ssh -i ~/.ssh/yorgos_pbx_vps_600 root@<NEW_IP>
```

## 2. Run the playbook
```bash
ansible-playbook -i ansible/inventory.ini ansible/playbook.yml \
  --ask-vault-pass -e target_host=<NEW_IP>
```
This installs Asterisk + ffmpeg + python3, deploys `/opt/opiflow/provision-asterisk.py`,
writes `/etc/opiflow/sip.env` from Vault, and installs the per-minute flock cron.

## 3. Apply the base config
Restore `/etc/asterisk/*.conf` (trunk registration + `from-intertelecom`/`from-twilio`/
`from-webrtc` base contexts) from your backup (`infra/pbx/asterisk/` once extracted),
then:
```bash
asterisk -rx "core reload"
asterisk -rx "pjsip show registrations"   # trunk should be Registered
```

## 4. Re-point carrier + Twilio
- InterTelecom: update the trunk peer to the new IP (or confirm registration outbound).
- Twilio: set the SIP Domain / outbound SIP URI to `<NEW_IP>:5060`; update
  `TWILIO_OUTBOUND_SIP_DOMAIN` in Vercel if it's an IP.

## 5. Verify
```bash
# the per-minute cron regenerates per-business config from Supabase within ~1 min
tail -f /var/log/opiflow-provision.log
asterisk -rx "dialplan show from-intertelecom"
```
- Place a test inbound call to a business DID → the native app rings, disclosure plays.
- Place a test outbound call → customer sees the business DID, disclosure plays.
- Confirm `/api/webhooks/voice/pbx` receives the call-completed event (Vercel logs).

## Keep a backup (do this now, while the box is healthy)
A read-only dump of the base config — run from your machine, does NOT modify the box:
```bash
mkdir -p infra/pbx/asterisk
scp -i ~/.ssh/yorgos_pbx_vps_600 \
  'root@46.224.138.115:/etc/asterisk/{pjsip.conf,extensions.conf,pjsip_*.conf,extensions_*.conf}' \
  infra/pbx/asterisk/
# redact the trunk password before committing; keep secrets in Vault only.
```
Commit the redacted result and delete the `TODO(extract)` markers. After this, the PBX
is fully reproducible from git.
