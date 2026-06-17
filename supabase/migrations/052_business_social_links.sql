-- 052: public contact/social links for the business (β).
--
-- facebook_url / instagram_url are shown as icons on the customer portal hero
-- (alongside the business phone). Edited in Settings → Επιχείρηση → Επικοινωνία.
-- Stored as free text (full URL or @handle); the portal normalizes to an href.
-- Tolerant rollout: the API reads/writes these via the existing /me + public
-- selects; absent (pre-052) they simply read as null.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS facebook_url  text,
  ADD COLUMN IF NOT EXISTS instagram_url text;
