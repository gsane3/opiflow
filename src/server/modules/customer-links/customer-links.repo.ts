// Customer links — repository (data access for the per-customer public-link routes:
// intake-link / upload-link / appointment-link).
//
// These three routes share the same shell: resolve the business (PK-keyed read on
// `businesses`), verify the customer belongs to the tenant (with a graceful
// degrade when `preferred_contact_method` / migration 035 is absent), and — for
// the appointment route — verify the appointment task. They also perform a handful
// of service-role token reads/writes (revoke pending tokens, verify a reviewed
// token hash, nudge customer.status / intake_status). Every read/write here is a
// faithful port of the live route, including the EXACT `.eq('business_id', …)` /
// PK-keyed filters, so the multi-tenant scoping is byte-for-byte unchanged.
//
// All unexpected DB rejections bubble up as plain throws; the service wraps its
// body in a single try/catch that converts any non-AppError into the route's
// catch-all code (server_error, 500), matching the original outer `catch`.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import { createServiceSupabaseClient } from '../../../lib/server/intake-tokens';

export type RepoContext = {
  userId: string;
  businessId: string;
  role: string;
  supabase: ReturnType<typeof createServerSupabaseClient>;
};

type SupabaseClient = RepoContext['supabase'];
type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

// ---------------------------------------------------------------------------
// businesses (PK-keyed: id = businessId)
// ---------------------------------------------------------------------------

export interface BusinessRow {
  id: string;
  name: string | null;
  email: string | null;
}

// Fetch by resolved business id (membership-aware), not owner_id — so invited
// team members keep the business name/email in the outgoing message.
export async function getBusiness(
  supabase: SupabaseClient,
  businessId: string,
): Promise<BusinessRow | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, name, email')
    .eq('id', businessId)
    .maybeSingle();
  return (data as unknown as BusinessRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// customers (business-scoped; PK + business_id filters, with graceful degrade)
// ---------------------------------------------------------------------------

export interface CustomerRow {
  id: string;
  mobile_phone: string | null;
  phone: string | null;
  email: string | null;
  preferred_contact_method?: string | null;
}

// Fetch the customer (business-scoped) including preferred_contact_method.
// Degrades gracefully if migration 035 (preferred_contact_method present /
// extended) has not been applied yet: on a column error we retry without it.
export async function fetchCustomer(
  supabase: SupabaseClient,
  customerId: string,
  businessId: string,
): Promise<{ customer: CustomerRow | null; error: boolean }> {
  const withPref = await supabase
    .from('customers')
    .select('id, mobile_phone, phone, email, preferred_contact_method')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (!withPref.error) {
    return { customer: (withPref.data as unknown as CustomerRow | null) ?? null, error: false };
  }

  // Likely the preferred_contact_method column is missing — retry without it.
  const base = await supabase
    .from('customers')
    .select('id, mobile_phone, phone, email')
    .eq('id', customerId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (base.error) {
    return { customer: null, error: true };
  }
  return { customer: (base.data as unknown as CustomerRow | null) ?? null, error: false };
}

// ---------------------------------------------------------------------------
// tasks (appointment route only; business + customer scoped)
// ---------------------------------------------------------------------------

export interface TaskRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  type: string;
  status: string;
  due_date: string | null;
  due_time: string | null;
}

export async function fetchAppointmentTask(
  supabase: SupabaseClient,
  taskId: string,
  businessId: string,
  customerId: string,
): Promise<{ task: TaskRow | null; error: boolean }> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, business_id, customer_id, type, status, due_date, due_time')
    .eq('id', taskId)
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) return { task: null, error: true };
  return { task: (data as unknown as TaskRow | null) ?? null, error: false };
}

// ---------------------------------------------------------------------------
// intake tokens (service-role)
// ---------------------------------------------------------------------------

export interface TokenLookupRow {
  id: string;
}

/** Returns true on a DB error so the caller can return server_error (500). */
export async function revokePendingIntakeTokens(
  serviceClient: ServiceClient,
  businessId: string,
  customerId: string,
  now: string,
): Promise<{ error: boolean }> {
  const { error } = await serviceClient
    .from('customer_intake_tokens')
    .update({ status: 'revoked', revoked_at: now, updated_at: now })
    .eq('business_id', businessId)
    .eq('customer_id', customerId)
    .in('status', ['pending', 'sent'])
    .is('revoked_at', null);
  return { error: Boolean(error) };
}

export async function findIntakeTokenByHash(
  serviceClient: ServiceClient,
  tokenHash: string,
  customerId: string,
  businessId: string,
  now: string,
): Promise<{ token: TokenLookupRow | null; error: boolean }> {
  const { data, error } = await serviceClient
    .from('customer_intake_tokens')
    .select('id')
    .eq('token_hash', tokenHash)
    .eq('customer_id', customerId)
    .eq('business_id', businessId)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', now)
    .maybeSingle();
  if (error) return { token: null, error: true };
  return { token: (data as unknown as TokenLookupRow | null) ?? null, error: false };
}

// After an intake request is actually delivered, flag the customer as awaiting
// their details (intake_status='sent'). This is what floats the contact to the
// top of the list («Λείπουν στοιχεία») and what the reminder/expire cron keys on.
// Best-effort: never block the send response on this.
export async function markCustomerIntakeSent(
  serviceClient: ServiceClient,
  businessId: string,
  customerId: string,
  nowIso: string,
): Promise<void> {
  try {
    await serviceClient
      .from('customers')
      .update({ intake_status: 'sent', updated_at: nowIso })
      .eq('id', customerId)
      .eq('business_id', businessId)
      // Don't clobber a customer who already completed/submitted their intake.
      .neq('intake_status', 'submitted');
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// upload tokens (service-role)
// ---------------------------------------------------------------------------

export async function findUploadTokenByHash(
  serviceClient: ServiceClient,
  tokenHash: string,
  customerId: string,
  businessId: string,
  now: string,
): Promise<{ token: TokenLookupRow | null; error: boolean }> {
  const { data, error } = await serviceClient
    .from('customer_upload_tokens')
    .select('id')
    .eq('token_hash', tokenHash)
    .eq('customer_id', customerId)
    .eq('business_id', businessId)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', now)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) return { token: null, error: true };
  return { token: (data as unknown as TokenLookupRow | null) ?? null, error: false };
}

// ---------------------------------------------------------------------------
// appointment response tokens (service-role)
// ---------------------------------------------------------------------------

export async function findApptTokenByHash(
  serviceClient: ServiceClient,
  tokenHash: string,
  taskId: string,
  businessId: string,
  now: string,
): Promise<{ token: TokenLookupRow | null; error: boolean }> {
  const { data, error } = await serviceClient
    .from('appointment_response_tokens')
    .select('id')
    .eq('token_hash', tokenHash)
    .eq('task_id', taskId)
    .eq('business_id', businessId)
    .in('status', ['pending', 'sent', 'opened'])
    .gt('expires_at', now)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) return { token: null, error: true };
  return { token: (data as unknown as TokenLookupRow | null) ?? null, error: false };
}

// Appointment link sent → nudge the customer to 'in_progress', but only from an
// earlier pipeline stage so we never downgrade an already-advanced customer
// (e.g. 'won' / 'lost'). The .in() guard makes this a no-op for any non-early
// status. Best-effort and non-fatal: the message was already sent.
export async function nudgeCustomerInProgress(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
): Promise<void> {
  try {
    await supabase
      .from('customers')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', customerId)
      .eq('business_id', businessId)
      .in('status', ['new', 'in_progress']);
  } catch {
    // intentionally swallowed: the appointment link was already sent
  }
}
