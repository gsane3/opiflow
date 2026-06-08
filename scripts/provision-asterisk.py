#!/usr/bin/env python3
"""
provision-asterisk.py — auto-provision per-user Opiflow SIP endpoints on Asterisk.

Runs ON the Asterisk box (via cron). Scales to hundreds of users with ZERO manual
config per user. For each Opiflow business it:
  1. ensures a per-user SIP password exists (mints + AES-256-GCM-encrypts it into
     Supabase if missing — same format as the app's src/lib/server/sip-credentials.ts),
  2. regenerates two Asterisk include files:
       OPIFLOW_PJSIP_FILE     one WebRTC endpoint/auth/aor per business (cloned from
                              the known-good `yorgospro001` template),
       OPIFLOW_DIALPLAN_FILE  [opiflow-inbound] mapping each DID -> its biz endpoint,
  3. reloads pjsip / dialplan ONLY if a file actually changed.

It NEVER touches the existing trunk / yorgospro001 / groundwire config. Activation
is via two `#include` lines + one dialplan tweak (see PROJECT_STATE.md telephony
sections). Idempotent and safe to run every minute.

Env (required):  SUPABASE_URL  SUPABASE_SERVICE_ROLE_KEY  SIP_CRED_ENC_KEY
Env (optional):
  OPIFLOW_PJSIP_FILE     (default /etc/asterisk/pjsip_opiflow_users.conf)
  OPIFLOW_DIALPLAN_FILE  (default /etc/asterisk/extensions_opiflow.conf)
  OPIFLOW_TLS_CERT       (default /etc/asterisk/tls/asterisk.pem)
  OPIFLOW_TLS_KEY        (default /etc/asterisk/tls/asterisk.key)
  OPIFLOW_RING_ALSO      (default groundwire001; also ring this endpoint; "" to disable)

Flags:
  --dry-run   fetch + mint-in-memory + print the config it WOULD write. No DB writes,
              no file writes, no reload. Safe to run anytime to preview.
"""

import os
import re
import sys
import json
import base64
import shutil
import secrets
import subprocess
import urllib.request
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

DRY = "--dry-run" in sys.argv


def _load_env_file(path):
    """Populate os.environ from a KEY=VALUE file (existing env vars win)."""
    if not path or not os.path.exists(path):
        return
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except Exception:
        pass


_load_env_file(os.environ.get("OPIFLOW_ENV_FILE", "/etc/opiflow/sip.env"))


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        sys.stderr.write(f"[provision] missing env {name}\n")
        sys.exit(1)
    return v


SUPABASE_URL = env("SUPABASE_URL", required=True).rstrip("/")
SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", required=True)
PJSIP_FILE = env("OPIFLOW_PJSIP_FILE", "/etc/asterisk/pjsip_opiflow_users.conf")
DIALPLAN_FILE = env("OPIFLOW_DIALPLAN_FILE", "/etc/asterisk/extensions_opiflow.conf")
TLS_CERT = env("OPIFLOW_TLS_CERT", "/etc/asterisk/tls/asterisk.pem")
TLS_KEY = env("OPIFLOW_TLS_KEY", "/etc/asterisk/tls/asterisk.key")
RING_ALSO = env("OPIFLOW_RING_ALSO", "groundwire001")


def load_key():
    raw = env("SIP_CRED_ENC_KEY", required=True).strip()
    key = bytes.fromhex(raw) if re.fullmatch(r"[0-9a-fA-F]{64}", raw) else base64.b64decode(raw)
    if len(key) != 32:
        sys.stderr.write("[provision] SIP_CRED_ENC_KEY must be 32 bytes (64 hex or base64)\n")
        sys.exit(1)
    return key


KEY = load_key()


def encrypt(plaintext):
    iv = secrets.token_bytes(12)
    blob = AESGCM(KEY).encrypt(iv, plaintext.encode(), None)  # ciphertext || 16-byte tag
    body, tag = blob[:-16], blob[-16:]
    return f"v1:{base64.b64encode(iv).decode()}:{base64.b64encode(tag).decode()}:{base64.b64encode(body).decode()}"


def decrypt(payload):
    try:
        v, ivb, tagb, ctb = payload.split(":")
        if v != "v1":
            return None
        iv, tag, body = base64.b64decode(ivb), base64.b64decode(tagb), base64.b64decode(ctb)
        return AESGCM(KEY).decrypt(iv, body + tag, None).decode()
    except Exception:
        return None


def gen_password():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(24))


def sb_get(path):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def sb_patch(path, body):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=json.dumps(body).encode(),
        method="PATCH",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    urllib.request.urlopen(req, timeout=20).read()


def sb_insert(path, body, resolution="ignore-duplicates"):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": f"resolution={resolution},return=minimal",
        },
    )
    urllib.request.urlopen(req, timeout=20).read()


def ensure_endpoint_rows():
    """Proactively create a browser_sip_endpoints row (status 'planned', deterministic
    sip_username 'biz_<id>') for every business that has an assigned number, so provisioning
    never waits for a user to open the phone first. We INSERT directly because the bundled
    ensure_browser_sip_endpoint() RPC has an ambiguous-column bug ('sip_username'); we ignore
    duplicates so existing active rows + their passwords are never touched."""
    bizs = sb_get("businesses?business_phone_number=not.is.null&select=id,owner_id")
    ok = 0
    for b in bizs:
        username = "biz_" + str(b["id"]).replace("-", "")
        try:
            sb_insert("browser_sip_endpoints?on_conflict=sip_username", {
                "business_id": b["id"],
                "user_id": b.get("owner_id"),
                "sip_username": username,
                "status": "planned",
            })
            ok += 1
        except Exception as e:
            sys.stderr.write(f"[provision] ensure row failed for {b.get('id')}: {e}\n")
    sys.stderr.write(f"[provision] ensure_endpoint_rows: {ok}/{len(bizs)} businesses\n")


def digits(s):
    return re.sub(r"\D", "", s or "")


# --- ensure a row exists for every business with a number (idempotent) --------
if not DRY:
    ensure_endpoint_rows()

# --- fetch business endpoints + their assigned DIDs ---------------------------
endpoints = sb_get(
    "browser_sip_endpoints?status=neq.revoked&select=id,business_id,sip_username,sip_password_enc,status"
)
biz_ids = sorted({e["business_id"] for e in endpoints if e.get("business_id")})
did_by_biz = {}
if biz_ids:
    rows = sb_get(f"businesses?id=in.({','.join(biz_ids)})&select=id,business_phone_number")
    did_by_biz = {b["id"]: b.get("business_phone_number") for b in rows}

users = []  # list of (username, password, did)
for e in endpoints:
    username = e.get("sip_username")
    did = did_by_biz.get(e.get("business_id"))
    if not username or not did:
        continue  # need both a username and an assigned number to be routable
    pw = decrypt(e["sip_password_enc"]) if e.get("sip_password_enc") else None
    if not pw:
        pw = gen_password()
        if not DRY:
            sb_patch(
                f"browser_sip_endpoints?id=eq.{e['id']}",
                {
                    "sip_password_enc": encrypt(pw),
                    "sip_password_set_at": datetime.now(timezone.utc).isoformat(),
                    "status": "active",
                },
            )
    users.append((username, pw, did))

users.sort(key=lambda t: t[0])


# --- generate pjsip endpoints (cloned from yorgospro001) ----------------------
def did_30form(did):
    """Greek caller-ID form for PAI/RPID: 30XXXXXXXXXX (country code, no '+')."""
    d = digits(did)
    if not d:
        return ""
    if d.startswith("30"):
        return d
    if len(d) == 10:  # local Greek number -> prepend country code
        return "30" + d
    return d


def pjsip_block(u, pw, did):
    # set_var=OPIFLOW_DID makes the business's own DID available on every channel
    # that originates from this endpoint, so from-webrtc can stamp it as the
    # outbound caller-ID (PAI/RPID) — per InterTelecom's 30XXXXXXXXXX format.
    d30 = did_30form(did)
    return f"""[{u}]
type=endpoint
transport=transport-wss
context=from-webrtc
disallow=all
allow=ulaw
allow=alaw
webrtc=yes
use_avpf=yes
force_avp=yes
media_encryption=dtls
media_use_received_transport=yes
dtls_verify=no
dtls_setup=actpass
dtls_cert_file={TLS_CERT}
dtls_private_key={TLS_KEY}
ice_support=yes
rtcp_mux=yes
auth={u}
aors={u}
direct_media=no
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes
set_var=OPIFLOW_DID={d30}

[{u}]
type=auth
auth_type=userpass
username={u}
password={pw}

[{u}]
type=aor
remove_existing=yes
max_contacts=1
minimum_expiration=60
qualify_frequency=60
support_path=yes
"""


pjsip_out = "; AUTO-GENERATED by provision-asterisk.py — DO NOT EDIT BY HAND.\n"
pjsip_out += "; One WebRTC endpoint per Opiflow business (cloned from yorgospro001).\n\n"
pjsip_out += "\n".join(pjsip_block(u, pw, _d) for (u, pw, _d) in users)


# --- generate inbound DID routing --------------------------------------------
# Each DID is emitted as the full digit string AND (for Greek E.164) the version
# without the '30' country code, to match whatever form the trunk delivers.
dp = "; AUTO-GENERATED by provision-asterisk.py — DO NOT EDIT BY HAND.\n"
dp += "; Inbound DID -> per-user endpoint. Sets OPIFLOW_EP then reuses from-intertelecom,s.\n"
dp += "[opiflow-inbound]\n"
seen = set()
for (u, _pw, did) in users:
    forms = set()
    d = digits(did)
    if d:
        forms.add(d)
        if d.startswith("30") and len(d) > 10:
            forms.add(d[2:])
    for f in sorted(forms):
        if f in seen:
            continue
        seen.add(f)
        dp += f"exten => {f},1,Set(OPIFLOW_EP={u})\n same => n,Goto(from-intertelecom,s,1)\n"


# --- dry run: print and exit --------------------------------------------------
if DRY:
    print(f"===== DRY RUN: would write {PJSIP_FILE} =====")
    print(pjsip_out)
    print(f"===== DRY RUN: would write {DIALPLAN_FILE} =====")
    print(dp)
    sys.stderr.write(f"[provision] dry-run users={len(users)} (no DB writes, no file writes, no reload)\n")
    sys.exit(0)


# --- write atomically + reload only what changed ------------------------------
def write_if_changed(path, content):
    # These files contain plaintext SIP passwords → write them 0640 root:asterisk
    # (asterisk-readable, NOT world-readable) atomically before the rename.
    new = content.encode()
    old = open(path, "rb").read() if os.path.exists(path) else None
    if old == new:
        return False
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    with os.fdopen(fd, "wb") as f:
        f.write(new)
    try:
        shutil.chown(tmp, user="root", group="asterisk")
    except Exception:
        pass
    os.replace(tmp, path)
    return True


changed_pjsip = write_if_changed(PJSIP_FILE, pjsip_out)
changed_dp = write_if_changed(DIALPLAN_FILE, dp)
if changed_pjsip:
    subprocess.run(["asterisk", "-rx", "pjsip reload"], check=False)
if changed_dp:
    subprocess.run(["asterisk", "-rx", "dialplan reload"], check=False)

sys.stderr.write(
    f"[provision] users={len(users)} pjsip_changed={changed_pjsip} dialplan_changed={changed_dp}\n"
)
