-- yorgos.ai Slice 1 - Customer upload tokens
-- Secure public upload links for customers. Customers open the link and will
-- upload photos/videos in a later slice (Slice 2).
--
-- Raw public tokens are never stored. Only SHA-256 hashes are written to this table.
-- Public upload pages must call server API routes that use service_role.
-- No authenticated or anonymous policies are created for this table by design.
-- See src/lib/server/upload-tokens.ts for the server-side helper.

CREATE TABLE IF NOT EXISTS public.customer_upload_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash    text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  sent_channel  text,
  sent_to_phone text,
  expires_at    timestamptz NOT NULL,
  opened_at     timestamptz,
  completed_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_upload_tokens_status_check
    CHECK (status IN ('pending', 'sent', 'opened', 'completed', 'expired', 'revoked')),

  CONSTRAINT customer_upload_tokens_sent_channel_check
    CHECK (sent_channel IS NULL OR sent_channel IN ('viber', 'sms', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_upload_tokens_token_hash_unique
  ON public.customer_upload_tokens (token_hash);

CREATE INDEX IF NOT EXISTS customer_upload_tokens_business_customer_idx
  ON public.customer_upload_tokens (business_id, customer_id);

CREATE INDEX IF NOT EXISTS customer_upload_tokens_expires_idx
  ON public.customer_upload_tokens (expires_at);

CREATE INDEX IF NOT EXISTS customer_upload_tokens_status_idx
  ON public.customer_upload_tokens (status);

ALTER TABLE public.customer_upload_tokens ENABLE ROW LEVEL SECURITY;

-- No authenticated or anon policies by design.
-- Upload token lookup and status updates happen only through trusted server API routes.

REVOKE ALL PRIVILEGES ON TABLE public.customer_upload_tokens FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.customer_upload_tokens FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.customer_upload_tokens FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_upload_tokens TO service_role;
