-- Migration 034: RLS defense-in-depth on service-only tables.
--
-- Additive and idempotent. Safe to re-run.
--
-- Context: the app accesses all business data through the SERVICE-ROLE client,
-- which BYPASSES Row Level Security — tenant isolation is enforced in code via a
-- per-route `.eq('business_id', ...)` filter. That works, but leaves no DB-level
-- safety net. This migration ENABLES RLS on the remaining service-only tables
-- (028 already did customers/communications/offers/tasks; 031/032/033 enabled it
-- on their own tables). With RLS enabled and NO anon/authenticated policy, those
-- keys are denied direct table access, while the service_role STILL bypasses RLS —
-- so the application is completely unaffected. This is pure defense-in-depth: if
-- the anon key ever leaked, it could not read these tables directly.
--
-- We intentionally do NOT touch package_plans / voucher_codes (potential public
-- reads) or businesses / business_users (auth-critical, policy-managed elsewhere).

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'offer_items',
    'offer_response_tokens',
    'appointment_response_tokens',
    'customer_intake_tokens',
    'customer_upload_sessions',
    'customer_upload_tokens',
    'viber_messages',
    'audit_events',
    'jobs',
    'business_phone_numbers',
    'business_phone_number_assignment_history',
    'browser_sip_endpoints',
    'business_subscriptions',
    'phone_number_requests',
    'provider_webhook_events',
    'managed_phone_numbers',
    'voucher_redemptions'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Deny the anon key outright (service_role bypasses RLS regardless).
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;
