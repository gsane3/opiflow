-- Asterisk PJSIP Realtime (ARA) — minimal schema for per-user browser endpoints.
--
-- IMPORTANT: This SQL is for the database **Asterisk** reads via ODBC (its own
-- Postgres/MySQL, or a dedicated schema) — NOT the Supabase app DB. It is kept
-- here so the app repo documents the full per-user SIP contract end to end.
-- See docs/ASTERISK_REALTIME_PROVISIONING.md.
--
-- This is a hand-written minimal subset of Asterisk's PJSIP realtime tables —
-- enough for WebRTC browser endpoints. For the complete, version-matched schema
-- use Asterisk's bundled alembic migrations (contrib/ast-db-manage). Columns
-- here use names Asterisk expects; add more as needed.

-- ---------------------------------------------------------------------------
-- ps_auths — one per business (username/password the browser phone presents)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ps_auths (
  id          varchar(40)  PRIMARY KEY,         -- = sip_username (biz_<business_id>)
  auth_type   varchar(20)  DEFAULT 'userpass',
  username    varchar(40),                      -- = sip_username
  password    varchar(80),                      -- = decrypted SIP password (see runbook A1/A2)
  realm       varchar(40)
);

-- ---------------------------------------------------------------------------
-- ps_aors — address of record (where the contact registers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ps_aors (
  id               varchar(40) PRIMARY KEY,      -- = sip_username
  max_contacts     integer     DEFAULT 1,
  remove_existing  varchar(3)  DEFAULT 'yes',
  qualify_frequency integer    DEFAULT 30
);

-- ---------------------------------------------------------------------------
-- ps_endpoints — the SIP endpoint config (WebRTC flags for browser phones)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ps_endpoints (
  id                       varchar(40) PRIMARY KEY,   -- = sip_username
  transport                varchar(40) DEFAULT 'transport-wss',
  aors                     varchar(40),               -- = sip_username
  auth                     varchar(40),               -- = sip_username
  context                  varchar(40) DEFAULT 'from-internal',
  disallow                 varchar(40) DEFAULT 'all',
  allow                    varchar(80) DEFAULT 'opus,ulaw,alaw',
  webrtc                   varchar(3)  DEFAULT 'yes',
  dtls_auto_generate_cert  varchar(3)  DEFAULT 'yes',
  ice_support              varchar(3)  DEFAULT 'yes',
  media_encryption         varchar(10) DEFAULT 'dtls',
  rtcp_mux                 varchar(3)  DEFAULT 'yes',
  use_avpf                 varchar(3)  DEFAULT 'yes',
  direct_media             varchar(3)  DEFAULT 'no',
  callerid                 varchar(80)                -- set to the business DID for outbound
);

-- ---------------------------------------------------------------------------
-- Provisioning template — run once per business (values from the app's
-- browser_sip_endpoints row; password from decryptSecret(sip_password_enc)).
-- Idempotent upserts so a sync job can re-run safely.
-- ---------------------------------------------------------------------------
--
-- INSERT INTO ps_auths (id, auth_type, username, password)
--   VALUES (:u, 'userpass', :u, :pw)
--   ON CONFLICT (id) DO UPDATE SET password = EXCLUDED.password;
--
-- INSERT INTO ps_aors (id, max_contacts, remove_existing)
--   VALUES (:u, 1, 'yes') ON CONFLICT (id) DO NOTHING;
--
-- INSERT INTO ps_endpoints (id, aors, auth, callerid)
--   VALUES (:u, :u, :u, :did) ON CONFLICT (id) DO UPDATE SET callerid = EXCLUDED.callerid;
--
--   :u   = 'biz_' || replace(business_id::text,'-','')
--   :pw  = decrypted SIP password
--   :did = business_phone_number (E.164) — used as outbound caller-id
