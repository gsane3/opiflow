-- 062: Index the inbound caller→customer lookup (audit P2-4).
--
-- Every inbound call (PBX webhook + in-app calls/log) resolves the caller with
--   .or('phone.eq.<n>,mobile_phone.eq.<n>,landline_phone.eq.<n>')  scoped by business_id.
-- Migration 027 indexed customers(business_id) and (business_id, created_at) but
-- NONE of the three phone columns, so that lookup is a seq-scan per inbound call —
-- the slowest part of the call-logging hot path on a tenant with many customers.
--
-- These composite (business_id, <phone column>) indexes make each branch of the
-- .or() an index lookup. Additive + idempotent; CONCURRENTLY is omitted because
-- the Supabase SQL editor runs in a transaction (plain CREATE INDEX is fine at
-- this scale — the tables are small today).

CREATE INDEX IF NOT EXISTS customers_business_phone_idx
  ON public.customers (business_id, phone);

CREATE INDEX IF NOT EXISTS customers_business_mobile_phone_idx
  ON public.customers (business_id, mobile_phone);

CREATE INDEX IF NOT EXISTS customers_business_landline_phone_idx
  ON public.customers (business_id, landline_phone);
