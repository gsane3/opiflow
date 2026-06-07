# Opiflow — Project State & Log (canonical)

> **This is the always-current source of truth for the Opiflow project.**
> Read it first at the start of every session. **Update it before every `/compact`**
> and after any significant change (infra IDs, changelog, current state, blockers,
> plan, loose ends). It lives in the repo, so it survives folder/repo renames.
> A private cross-session copy of the gist also lives at
> `~/.claude/projects/<proj>/memory/project_yorgos_ai.md`.
>
> **Last updated:** 2026-06-07 — session 7 (rebrand → Opiflow + PBX wiring, paused to organize).

---

## A. What Opiflow is
Greek, **mobile-first business-phone + CRM** for service technicians (HVAC first).
Positioning: **Customer Action Management (CAM)** — "from CRM to CAM". Every call
→ customer record + AI brief + next action; the tech sends the customer a Viber
link (intake / photos / offer / appointment); the customer answers on public token
pages (`/intake/[token]`, `/offer-response/[id]`, `/appointment-response/[id]`, `/upload/[token]`).
- Name history: **yorgos / smartpi → deskop → Opiflow** (current).
- Brand: emerald `#00C499` (primary), royal blue `#3361FF` (secondary), dark navy
  `#0A1120`; wordmark "opiflow.ai"; **light theme**.

## B. Live infrastructure — CANONICAL (verify here, do not trust older notes)
| Thing | Value |
|---|---|
| Live app | **https://opiflow.vercel.app** |
| Vercel project | **`sane127/opiflow`** (CLI logged in as `georgiostsipos-2366`) |
| Supabase project (LIVE) | **`oluhmztfimmgmbxoioea`** → https://oluhmztfimmgmbxoioea.supabase.co (confirmed in the deployed client bundle) |
| GitHub repo | `github.com/gsane3/yorgos` — **TO RENAME → `opiflow`** |
| Local folder | `E:\yorgos` — **TO RENAME → `E:\opiflow`** |
| PBX | Hetzner CPX22, Ubuntu 24.04, **`root@46.224.138.115`**, Asterisk 20.6 active |
| Trunk | InterTelecom `IT658318`; WebRTC transport **WSS :8089**; TLS `/etc/asterisk/tls/` |
| Shared SIP user | `yorgospro001` (= app's `PHONE_SIP_USERNAME`) + `groundwire001` (interim mobile) |
| Health | `GET /api/health` (booleans only) |

> ⚠️ **`hgboywgjddphzeiwtezw` is the OLD Supabase project — safe to DELETE.** The live
> app's deployed bundle uses `oluhmztfimmgmbxoioea`. **BUT the local `.env.local` is STALE:
> it still holds the OLD `hgboy` keys**, and the PBX `/etc/opiflow/sip.env` was seeded from
> it → the PBX currently points at the dead `hgboy`. **Fix: update `.env.local` to the
> `oluhmzt` keys, then re-ship the new service key to the PBX.** The "031 missing / 0 rows"
> earlier was just because we were querying the dead `hgboy` — 031 + data live on `oluhmzt`.
> Also delete the old Vercel project `yorgos` (→ `directsourcing.gr`) only if truly unused.

## C. Stack & architecture
- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind v4.
- Supabase `@supabase/supabase-js`: anon client (RLS) + service-role server client.
- Auth: client-side (`AppShell` getSession → `/login`); every API route re-checks the
  Bearer token; tenancy = `businesses.owner_id`; shared helper `authenticateBusinessRequest`.
- Telephony: browser **jsSIP** over the Asterisk WSS gateway; InterTelecom trunk;
  native background calling (CallKit/PushKit + Acrobits SDK) = **future**.
- Capacitor wrapper: appId `ai.opiflow.app`.
- Migrations: `supabase/migrations/NNN_*.sql` applied **manually via the Supabase SQL
  editor** (NOT Supabase-CLI timestamp format — do not `supabase db push`).

## D. Changelog (newest first)
- **2026-06-07 — session 7 (Opiflow rebrand + telephony scale):**
  - **PR #12 (6327cce) Rebrand deskop → Opiflow** — names everywhere; client Viber
    signature "μέσω Opiflow Assistant"; emerald theme via a single `@theme` remap of
    `indigo-*`→`#00C499` (covers 431 usages / 71 files); new flow-ring logo
    (`public/icon.svg` + regenerated PNGs, `src/components/brand/OpiflowLogo.tsx`);
    domain → `opiflow.vercel.app`; Android pkg `ai.deskop.app`→`ai.opiflow.app`. **LIVE.**
  - **PR #13 (56c822f) Per-user SIP provisioning + A/B onboarding + presence** —
    migration **031** (`browser_sip_endpoints.sip_password_enc`, `businesses.telephony_mode`,
    `business_user_presence`); `src/lib/server/sip-credentials.ts` (AES-256-GCM,
    `SIP_CRED_ENC_KEY` = enable switch); `browser-token` per-user path with **env
    fallback**; `/api/phone/presence` + `/api/phone/telephony`; Settings → `TelephonyPanel`.
    Backward-compatible / **inert until activated**.
  - **PR #14 (33e1bad) SIP sync worker (ARA approach)** — `scripts/sync-sip-to-asterisk.mjs`.
    ⚠️ **Superseded** by the static-config provisioner (the PBX has no DB).
  - **PBX wiring (uncommitted/in-progress)** — `scripts/provision-asterisk.py`.
- **2026-06-03 … 06-05 — sessions 1-6 (pre-rebrand, as "deskop"):** launch-readiness
  (mobile shell, security lockdown, dead-code removal, public pages, server onboarding
  gating, shared auth helper, Viber-modal dedup); marketing site; Google/Apple OAuth;
  CRM import/export; .ics + opportunity value + maps + notifications; demo removal;
  Capacitor wrapper + setup/cost docs; production roadmap (RLS, billing, Sentry,
  vitest, design system, Upstash rate-limit); in-app call recording → AI brief;
  CRM action wizards + offer numbering/value/status automation; inline accept/reject
  for appointment time-change. (PRs #1-#11, all merged.)

## E. Current state (where we are NOW)
- **App:** rebrand LIVE and healthy. Per-user-SIP code shipped but **INERT** — `SIP_CRED_ENC_KEY`
  not yet set on Vercel.
- **Supabase:** live = **`oluhmztfimmgmbxoioea`**; **migration 031 IS applied there** (verified:
  `sip_password_enc` exists). Data: **1 business, 1 active number, 0 `browser_sip_endpoints` rows.**
  (`hgboy` = old, to be deleted; the local `.env.local` was stale → user updated it to oluhmzt.)
- **PBX:** SSH access (key `~/.ssh/yorgos_pbx_vps_600`). `/opt/opiflow/provision-asterisk.py` +
  `/etc/opiflow/sip.env` now correctly point at **oluhmzt** with a working service key
  (verified: `--dry-run` connects; 0 users to provision yet). **Not yet wired into live Asterisk.**
  Backups `/etc/asterisk/{pjsip,extensions}.conf.opiflow-bak.20260607114549`.
- **Vercel CLI:** logged in + linked `sane127/opiflow`.

## F. Open problems / blockers
1. ✅ **RESOLVED — project confusion.** Live = `oluhmzt`; 031 is applied there; the PBX is
   repointed with a working service key. (The earlier "031 missing / 0 rows" was from querying
   the dead `hgboy`, because `.env.local` was stale.)
2. **`browser_sip_endpoints` has 0 rows** (1 business with an active number) → the provisioner
   must **proactively create rows**: call `ensure_browser_sip_endpoint` per
   business-with-active-number (POST `/rest/v1/rpc/ensure_browser_sip_endpoint`), then mint +
   generate. **(Not yet implemented — next coding step.)**
3. **Secret handling boundary:** the assistant **cannot read `.env.local` or move raw
   secrets** (safety rule + auto-mode classifier blocks `vercel env pull`, prod-secret
   reads). The user ships each secret via:
   `grep VAR= .env.local | tr -d '\r' | ssh -i ~/.ssh/yorgos_pbx_vps_600 root@46.224.138.115 "cat>>/etc/opiflow/<file>"`.
4. **PBX has no DB** → we use **static-config generation + reload** (not Asterisk Realtime).
   The committed `sync-sip-to-asterisk.mjs` and the ARA runbook are now out of date.

## G. Plan / next steps (telephony activation)
1. Apply migration **031** to **hgboy**.
2. Enhance `provision-asterisk.py` to self-create endpoint rows (proactive → scales to 30-50 users with zero manual work).
3. Wire **additively** (backups taken): `#include pjsip_opiflow_users.conf` in pjsip.conf;
   `#include extensions_opiflow.conf` in extensions.conf; in `from-intertelecom` change
   `Dial(PJSIP/yorgospro001&groundwire001)` → `Dial(PJSIP/${OPIFLOW_EP}&groundwire001)`
   with `OPIFLOW_EP` defaulting to `yorgospro001`; `include => opiflow-inbound`.
4. Set `SIP_CRED_ENC_KEY` on Vercel (same value as the box) → **flip** to per-user.
5. Test one provisioned business: inbound rings the right endpoint + outbound works.
6. `cron` the provisioner (every minute).
   Rollback at any point: unset Vercel key (app → shared `yorgospro001`); remove includes + reload.

## H. Cleanup pending (org)
- **Delete OLD projects** (keep only the new): old Supabase project + Vercel `yorgos`
  (directsourcing.gr) — **confirm each is unused before deleting**; keep Supabase `hgboy`
  + Vercel `opiflow`. After any key/password rotation, **re-update `.env.local`** AND
  re-ship the new service key to the PBX + update Vercel env.
- Remove/replace the superseded `scripts/sync-sip-to-asterisk.mjs`; rewrite
  `docs/ASTERISK_REALTIME_PROVISIONING.md` for the static-config approach.
- Decide the orphaned AI-suggestion scaffolding in `src/app/(app)/customers/[id]/page.tsx`
  (declared/set, never used) → **recommend discard** (`git checkout`).

## I. Renames pending (org)
- **GitHub repo** `gsane3/yorgos` → `gsane3/opiflow` (user: repo Settings → Rename;
  then assistant runs `git remote set-url origin …/opiflow.git` — GitHub auto-redirects).
- **Local folder** `E:\yorgos` → `E:\opiflow` (do it with NO active Claude session;
  no code hardcodes the path; the assistant migrates the `~/.claude` memory dir after).
- Already done: Vercel project = `opiflow`, app domain = `opiflow.vercel.app`, Capacitor
  `ai.opiflow.app`, package name `opiflow`.

## J. Secrets / access map
- **Assistant CAN:** git + `gh` (authenticated); SSH to PBX (key present); Vercel CLI
  (logged in, linked).
- **Assistant CANNOT:** read `.env.local`; enter/move raw secrets (service key, DB
  password, enc key). The user must place those (one-line `grep|ssh` ships, or dashboard).
- Secret locations: `.env.local` (local), Vercel env (prod app), `/etc/opiflow/sip.env`
  (+ planned `db.env`) on the PBX.

## K. Update protocol
Before every `/compact` (and after notable changes): bump **Last updated**, append to
**D. Changelog**, and refresh **E/F/G** (state / blockers / plan). Keep **B** (infra IDs)
exact — it is the canonical reference.
