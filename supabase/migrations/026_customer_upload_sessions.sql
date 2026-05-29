-- yorgos.ai Slice 2 - Customer upload sessions
-- Records metadata for files uploaded by customers through upload links.
-- Files are stored in Supabase Storage bucket "customer-uploads" (private).
-- Rows are written by service_role API routes only.
-- Authenticated users (business owners) can SELECT their own sessions via RLS.
--
-- Storage bucket notes:
--   * Bucket is private (public = false). No public read access.
--   * Uploads use short-lived signed upload URLs created server-side with service_role.
--   * File bytes travel directly from the customer browser to Supabase Storage.
--   * Next.js API routes do not receive file bytes.

-- ---------------------------------------------------------------------------
-- Storage bucket: customer-uploads
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customer-uploads',
  'customer-uploads',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'image/webp',
    'video/mp4',
    'video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.customer_upload_sessions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id       uuid        NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  upload_token_id   uuid        NOT NULL REFERENCES public.customer_upload_tokens(id) ON DELETE CASCADE,
  file_count        integer     NOT NULL DEFAULT 0,
  files             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  customer_comment  text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_upload_sessions_business_customer_idx
  ON public.customer_upload_sessions (business_id, customer_id);

CREATE INDEX IF NOT EXISTS customer_upload_sessions_upload_token_idx
  ON public.customer_upload_sessions (upload_token_id);

CREATE INDEX IF NOT EXISTS customer_upload_sessions_uploaded_at_idx
  ON public.customer_upload_sessions (uploaded_at DESC);

ALTER TABLE public.customer_upload_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upload_sessions_select_business_members" ON public.customer_upload_sessions;
CREATE POLICY "upload_sessions_select_business_members"
  ON public.customer_upload_sessions
  FOR SELECT
  TO authenticated
  USING (
    business_id IN (
      SELECT bu.business_id
      FROM public.business_users bu
      WHERE bu.user_id = auth.uid()
    )
  );

REVOKE ALL PRIVILEGES ON TABLE public.customer_upload_sessions FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.customer_upload_sessions FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.customer_upload_sessions FROM service_role;

GRANT SELECT ON TABLE public.customer_upload_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_upload_sessions TO service_role;
