# Asterisk base config (hand-applied parts, now templated in git)

These are the **base** Asterisk config files — the stable, hand-applied parts that
the per-minute provisioner (`scripts/provision-asterisk.py`) deliberately never
touches. Until now they lived **only** on the box (`root@46.224.138.115`), the #1
single point of failure. They are now reproducible from git.

| File | Deploy path | Authority |
|---|---|---|
| `pjsip.base.conf` | `/etc/asterisk/pjsip.conf` | **Trunk = verbatim** from `docs/PBX_SETUP_FOR_INTERTELECOM.md §3` (confirmed Registered). WebRTC `transport-wss` = standard shape → verify. |
| `extensions.base.conf` | `/etc/asterisk/extensions.conf` | `from-intertelecom` / `from-twilio` = from docs §4–§5. `from-webrtc` = reconstructed → verify. |
| `http.conf` | `/etc/asterisk/http.conf` | Standard WebRTC WSS shape → verify. |
| `voicemail.conf` | `/etc/asterisk/voicemail.conf` | Reference stub (product voicemail goes via MixMonitor → webhook, not Asterisk mailboxes). |
| `captured/` | — | Authoritative copies pulled from the live box by `capture-base-config.sh` (gitignored secrets redacted). **Trust these over the templates.** |

## Make it authoritative (one command, read-only, owner runs)

```bash
./infra/pbx/capture-base-config.sh        # scp the live /etc/asterisk/*.conf, auto-redact secrets
grep -riE 'password|secret|token' infra/pbx/asterisk/captured/   # confirm nothing leaked
git add infra/pbx/asterisk/captured && git commit -m "infra(pbx): capture live base config"
```

After that, the templates here can be reconciled with `captured/` and the PBX is
fully reproducible from git. See `../RESTORE_RUNBOOK.md` for the full rebuild and
`../backup-pbx.sh` for the daily on-box backup.

## Secrets — never committed
The InterTelecom trunk password, `SIP_CRED_ENC_KEY`, and `PBX_WEBHOOK_SECRET` live
in Ansible Vault / `/etc/opiflow/sip.env` only. The templates use placeholders;
`capture-base-config.sh` redacts `password=`/`secret=` lines before saving.
