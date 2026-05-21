-- yorgos.ai Option 2 Live Demo
-- Secure public intake links for customers created from inbound calls.
--
-- This table stores only token hashes, never raw public tokens.
-- Public intake pages must call server API routes that use service_role.
-- No authenticated or anonymous policies are created for this table.

CREATE TABLE IF NOT EXISTS public.customer_intake_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token_hash    text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  sent_channel  text,
  sent_to_phone text,
  expires_at    timestamptz NOT NULL,
  opened_at     timestamptz,
  submitted_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customer_intake_tokens_status_check
    CHECK (status IN ('pending', 'sent', 'opened', 'submitted', 'expired', 'revoked')),

  CONSTRAINT customer_intake_tokens_sent_channel_check
    CHECK (sent_channel IS NULL OR sent_channel IN ('viber', 'sms', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_intake_tokens_token_hash_unique
  ON public.customer_intake_tokens (token_hash);

CREATE INDEX IF NOT EXISTS customer_intake_tokens_business_customer_idx
  ON public.customer_intake_tokens (business_id, customer_id);

CREATE INDEX IF NOT EXISTS customer_intake_tokens_status_expires_idx
  ON public.customer_intake_tokens (status, expires_at);

CREATE INDEX IF NOT EXISTS customer_intake_tokens_created_idx
  ON public.customer_intake_tokens (created_at);

ALTER TABLE public.customer_intake_tokens ENABLE ROW LEVEL SECURITY;

-- No authenticated or anon policies by design.
-- Intake token lookup and customer updates happen only through trusted server API routes.

REVOKE ALL PRIVILEGES ON TABLE public.customer_intake_tokens FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.customer_intake_tokens FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.customer_intake_tokens FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_intake_tokens TO service_role;
