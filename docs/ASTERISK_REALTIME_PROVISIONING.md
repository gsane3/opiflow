# Per-user SIP provisioning — Asterisk runbook

This is the **PBX side** of the per-user SIP feature. The app side (per-user
credentials, A/B onboarding, presence) ships in the repo and is **inert until you
complete the steps below** — until then the browser phone keeps using the shared
`PHONE_SIP_*` credentials exactly as today.

> **TL;DR flip-switch:** the app stays on the shared SIP account until you set
> the Vercel env var **`SIP_CRED_ENC_KEY`**. Set it only **after** Asterisk can
> authenticate per-user endpoints (steps 1–4 below). Unset it to roll back
> instantly.

---

## How it works

```
 Onboarding/number assign ─┐
                           ▼
 app: browser_sip_endpoints   (one row per business)
   sip_username = biz_<business_id>           ← deterministic, created by
   sip_password_enc = AES-256-GCM(password)     ensure_browser_sip_endpoint()
                           │
        GET /api/phone/browser-token  decrypts → hands the phone its OWN creds
                           │
                           ▼
 Browser phone (jsSIP) ──REGISTER──▶ Asterisk WSS  wss://…:8089/ws
                                          │  authenticates against ps_auths
                                          ▼
                              InterTelecom trunk  ◀── outbound (caller-id = DID)
                              DID → endpoint      ◀── inbound (ring the right app)
```

The **only** thing Asterisk needs is a PJSIP endpoint + auth + aor per business,
whose `username`/`password` match what the app issues. Two ways to get them there:

| Option | How | When to use |
|---|---|---|
| **A. Realtime (recommended)** | Asterisk reads `ps_endpoints` / `ps_auths` / `ps_aors` from a DB via ODBC. "Provisioning a user" = inserting rows — no reload, no SSH per user. | Production / many users |
| **B. Static + reload** | Generate `pjsip.conf` snippets and `pjsip reload`. | Quick test / few users |

This runbook uses **Option A**.

---

## Credential delivery: keep the password readable by Asterisk

The app stores the SIP password **encrypted** (`sip_password_enc`). Asterisk needs
the **plaintext** (or an `md5_cred`) in `ps_auths`. Pick one:

- **A1 — Sync job (most secure at rest):** a small cron/worker decrypts with
  `SIP_CRED_ENC_KEY` and upserts `ps_auths.password`. The app DB never exposes
  plaintext. Sketch:

  ```js
  // runs where SIP_CRED_ENC_KEY is available (e.g. a Vercel cron / small worker)
  // 1) read browser_sip_endpoints (status='active') from Supabase
  // 2) decryptSecret(sip_password_enc)  // src/lib/server/sip-credentials.ts
  // 3) upsert into Asterisk DB: ps_auths(id, auth_type='userpass', username, password)
  //                              ps_aors(id, max_contacts=1, remove_existing=yes)
  //                              ps_endpoints(id, transport, aors, auth, webrtc=yes, …)
  ```

- **A2 — Shared DB view (simplest ops):** point Asterisk ODBC at a DB/schema that
  exposes a `ps_auths` **view** built from `browser_sip_endpoints`. Requires the
  decryption key in the DB (pgcrypto) — i.e. **plaintext-equivalent at rest**.
  Acceptable for early stage; revisit before scale.

Recommendation: start with **A2** for speed, move to **A1** before real volume.

---

## Steps

### 1. Create the realtime tables
Apply `supabase/asterisk/ara_pjsip_realtime.sql` to the **database Asterisk will
read** (its own Postgres/MySQL, or a dedicated schema). This is the canonical
PJSIP realtime subset (`ps_endpoints`, `ps_auths`, `ps_aors`).

### 2. Point Asterisk at the DB (ODBC + realtime)
`/etc/odbc.ini` + `res_odbc.conf`:
```ini
; res_odbc.conf
[asterisk]
enabled => yes
dsn => asterisk-pg
pre-connect => yes
```
`sorcery.conf`:
```ini
[res_pjsip]
endpoint=realtime,ps_endpoints
auth=realtime,ps_auths
aor=realtime,ps_aors
```
`extconfig.conf`:
```ini
[settings]
ps_endpoints => odbc,asterisk
ps_auths     => odbc,asterisk
ps_aors      => odbc,asterisk
```
Reload: `module reload res_odbc.so res_pjsip.so` then `pjsip show endpoints`.

### 3. WebRTC transport
Ensure a WSS transport on `:8089` (the gateway the browser already uses):
```ini
; pjsip.conf (transport stays static)
[transport-wss]
type=transport
protocol=wss
bind=0.0.0.0:8089
```
Per-endpoint WebRTC flags live in `ps_endpoints` (`webrtc=yes`, `dtls_auto_generate_cert=yes`, `ice_support=yes`, `media_encryption=dtls`). See the SQL file's INSERT template.

### 4. Provision a business → endpoint
For each `browser_sip_endpoints` row (`sip_username = biz_<id>`), ensure matching
`ps_auths` / `ps_aors` / `ps_endpoints` rows (via A1 sync or A2 view). Verify:
```
pjsip show endpoint biz_<id>
```

### 5. Routing (dialplan)
- **Inbound:** map each DID → its endpoint. With realtime, keep a small
  `extensions.conf` that looks up the business by `called_number` (the app's
  `business_phone_numbers` already stores the mapping) and `Dial(PJSIP/biz_<id>)`.
  If `business_user_presence` ≠ `available`, send to AI intake / voicemail and
  POST the existing PBX webhook so the app logs a missed call + Viber follow-up.
- **Outbound:** `Dial(PJSIP/${EXTEN}@intertelecom-trunk)` with
  `Set(CALLERID(num)=<the business DID>)`.

### 6. Model A (keep own number)
Model A is **carrier-side call forwarding** from the user's own number to their
assigned DID — no Asterisk change. The app shows the GSM divert codes
(`**21*<DID>#`). Once the call hits the DID it follows step 5 like any inbound.

### 7. Flip the app to per-user
Set on Vercel (Production): `SIP_CRED_ENC_KEY` = a 32-byte key, as **64-hex** or
**base64**. Generate one:
```bash
openssl rand -hex 32
```
Deploy/redeploy. From then on `/api/phone/browser-token` issues per-user creds
and mints+stores each business's password on first phone use. **Roll back** by
removing the var.

---

## Verify & rollback
- Health: `GET /api/health` → `integrations.sipPerUser` becomes `true` once the key is set.
- Each user: open the phone → it should REGISTER as `biz_<id>` (check `pjsip show contacts`).
- Rollback at any time: unset `SIP_CRED_ENC_KEY` → instant return to shared-env creds (no data lost; encrypted passwords remain for when you re-enable).

## Security notes
- `SIP_CRED_ENC_KEY` lives ONLY in the app env (Vercel). Never commit it.
- Rotating the key invalidates stored passwords; the app regenerates them on next
  phone use, but you must re-sync to Asterisk (A1/A2).
- `browser_sip_endpoints` writes are service-role only; the table never exposes plaintext.
