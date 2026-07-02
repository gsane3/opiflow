// Public intake — service (orchestration of the prefill + submit logic). Parity-
// matched to the two /api/intake/[token] routes.
//
// PUBLIC TOKEN auth: the businessId/customerId come from the verified intake token
// (findValidIntakeToken via the repo), never from a business user. The token verify,
// the content-type guard, the rate-limit guard and the redirect-vs-JSON response
// mapping STAY in the thin route; this service owns the DB orchestration that runs
// after the token is resolved.
//
// The service returns DISCRIMINATED OUTCOMES (a `kind` field) rather than building
// NextResponse, because the original route maps the SAME logical outcome to either a
// JSON body or a 303 redirect depending on the request content-type (acceptsForm).
// The route translates these outcomes back to the exact bodies/statuses/redirects.
//
// Catch parity: the original GET/POST each wrap their whole body in ONE try/catch
// returning intake_load_failed / intake_submit_failed (500). To preserve that, the
// service does NOT add its own broad catch around the DB calls — a DB-load throw
// (selectCustomer) or any unexpected throw propagates to the route's outer catch
// exactly as before. The per-update best-effort swallows live in the repo, matching
// the original's inline try/catch around the preferred-method / extras / comment writes.

import {
  markIntakeTokenOpened,
  markIntakeTokenSubmitted,
  type IntakeTokenRow,
} from '../../../lib/server/intake-tokens';
import {
  createServiceClient,
  findIntakeToken,
  insertInboundComment,
  loadCustomerExtras,
  loadPublicBusinessRow,
  selectCustomer,
  updateCoreCustomer,
  updateCustomerExtras,
  updatePreferredContactMethod,
  type CustomerExtras,
  type CustomerRow,
  type BusinessRow,
} from './public-intake.repo';

// ---------------------------------------------------------------------------
// Pure helpers (verbatim from the route)
// ---------------------------------------------------------------------------

// The public link is delivered over viber/sms/email; the form submission itself
// has no channel, so we reuse the delivery channel for the inbound row (default
// viber). Matches the offer/appointment-response audit-row convention.
function inboundChannel(sent: 'viber' | 'sms' | 'email' | 'manual' | null): 'viber' | 'sms' | 'email' {
  return sent === 'sms' || sent === 'email' ? sent : 'viber';
}

// Public intake form offers these three; the full DB set also allows 'phone'.
// WhatsApp was removed in the redesign (migration 042 narrows the
// customers_preferred_contact_method_check constraint back to viber/sms/email/phone).
const VALID_PREFERRED_CONTACT_METHODS = ['viber', 'sms', 'email'] as const;
type PreferredContactMethod = (typeof VALID_PREFERRED_CONTACT_METHODS)[number];

function preferredContactMethod(value: unknown): PreferredContactMethod | null {
  return (VALID_PREFERRED_CONTACT_METHODS as readonly string[]).includes(value as string)
    ? (value as PreferredContactMethod)
    : null;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

export function publicCustomer(row: CustomerRow, extras: CustomerExtras = { postalCode: null, region: null }) {
  return {
    crmNumber: row.crm_number,
    displayName: row.name ?? row.company_name ?? row.crm_number ?? 'Πελάτης',
    phoneMasked: maskPhone(row.phone ?? row.mobile_phone ?? row.landline_phone),
    companyName: row.company_name,
    email: row.email,
    address: row.address,
    postalCode: extras.postalCode,
    region: extras.region,
    notes: row.notes,
    needsSummary: row.needs_summary,
    intakeStatus: row.intake_status,
  };
}

export function publicBusiness(row: BusinessRow | null) {
  if (!row) return null;
  const name = row.trade_name?.trim() || row.legal_name?.trim() || row.name?.trim() || null;
  if (!name && !row.logo_url) return null;
  return {
    name: name ?? 'Η επιχείρηση',
    logoUrl: row.logo_url,
    phone: row.phone,
    email: row.email,
    website: row.website,
  };
}

export async function loadPublicBusiness(businessId: string) {
  return publicBusiness(await loadPublicBusinessRow(businessId));
}

function buildName(firstName: string | null, lastName: string | null): string | null {
  const parts = [firstName, lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// Shared token+customer resolution (verbatim from getCustomerForToken)
// ---------------------------------------------------------------------------

async function getCustomerForToken(rawToken: string): Promise<{
  tokenRow: IntakeTokenRow | null;
  customer: CustomerRow | null;
}> {
  const tokenRow = await findIntakeToken(rawToken);

  if (!tokenRow) {
    return { tokenRow: null, customer: null };
  }

  const supabase = createServiceClient();
  const customer = await selectCustomer(supabase, tokenRow.customer_id, tokenRow.business_id);

  return {
    tokenRow,
    customer,
  };
}

// ---------------------------------------------------------------------------
// GET — prefill
// ---------------------------------------------------------------------------

export type LoadIntakeResult =
  | { kind: 'invalid' }
  | {
      kind: 'ok';
      customer: ReturnType<typeof publicCustomer>;
      business: Awaited<ReturnType<typeof loadPublicBusiness>>;
    };

export async function loadIntake(token: string): Promise<LoadIntakeResult> {
  const { tokenRow, customer } = await getCustomerForToken(token);

  if (!tokenRow || !customer) {
    return { kind: 'invalid' };
  }

  await markIntakeTokenOpened(tokenRow.id);

  const supabase = createServiceClient();
  const extras = await loadCustomerExtras(supabase, customer.id, customer.business_id);

  return {
    kind: 'ok',
    customer: publicCustomer(customer, extras),
    business: await loadPublicBusiness(tokenRow.business_id),
  };
}

// ---------------------------------------------------------------------------
// POST — submit
// ---------------------------------------------------------------------------

export type SubmitIntakeResult =
  | { kind: 'missing_name' }
  | { kind: 'customer_update_failed' }
  | { kind: 'customer_not_found' }
  | { kind: 'ok'; customer: ReturnType<typeof publicCustomer> };

/**
 * Resolved token + customer. `null` means the token was invalid/expired or the
 * customer row is missing — the route maps that to the invalid/expired response.
 * This is split out so the route resolves the token BEFORE parsing the request
 * body, exactly as the original POST did (token check precedes body parse).
 */
export interface ResolvedIntake {
  tokenRow: IntakeTokenRow;
  customer: CustomerRow;
}

export async function resolveIntakeForSubmit(token: string): Promise<ResolvedIntake | null> {
  const { tokenRow, customer } = await getCustomerForToken(token);
  if (!tokenRow || !customer) {
    return null;
  }
  return { tokenRow, customer };
}

// Push payload shape (structurally identical to PushPayload in lib/server/push)
// — declared here so the service does NOT import lib/server/push, whose transitive
// `@/lib/supabase/server` import isn't resolvable under the test runner. The route
// injects the real sendPushToBusinessOwner as `notifyOwner`.
export interface NotifyOwnerPayload {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string>;
}

export type NotifyOwner = (businessId: string, payload: NotifyOwnerPayload) => Promise<void>;

/** Dependencies injected so the service stays unit-testable (push is fire-and-forget). */
export interface SubmitIntakeDeps {
  /** The owner-notification sender (lib/server/push#sendPushToBusinessOwner), injected by the route. */
  notifyOwner?: NotifyOwner;
}

export async function submitIntake(
  resolved: ResolvedIntake,
  raw: Record<string, unknown>,
  deps: SubmitIntakeDeps = {},
): Promise<SubmitIntakeResult> {
  const notifyOwner = deps.notifyOwner;

  const { tokenRow, customer } = resolved;

  const firstName = str(raw.firstName);
  const lastName = str(raw.lastName);
  const email = str(raw.email);
  const companyName = str(raw.companyName);
  const address = str(raw.address);
  const postalCode = str(raw.postalCode);
  const region = str(raw.region);
  const needsSummary = str(raw.needsSummary);
  const comments = str(raw.comments);
  const preferred = preferredContactMethod(raw.preferredContactMethod);

  if (!firstName && !lastName) {
    return { kind: 'missing_name' };
  }

  const name = buildName(firstName, lastName);
  const now = new Date().toISOString();
  const notesParts = [
    customer.notes,
    comments ? `Σχόλια φόρμας: ${comments}` : null,
  ].filter(Boolean);

  const supabase = createServiceClient();
  // company_name / needs_summary exist since 003 → safe in the core update.
  // Only overwrite them when the customer actually supplied a value, so a
  // blank field never wipes data the business already had on file.
  const coreUpdate: Record<string, unknown> = {
    name,
    email,
    address,
    notes: notesParts.length > 0 ? notesParts.join('\n\n') : null,
    intake_status: 'submitted',
    updated_at: now,
  };
  if (companyName) coreUpdate.company_name = companyName;
  if (needsSummary) coreUpdate.needs_summary = needsSummary;

  const { data, error } = await updateCoreCustomer(supabase, customer.id, customer.business_id, coreUpdate);

  if (error) {
    return { kind: 'customer_update_failed' };
  }

  if (!data) {
    return { kind: 'customer_not_found' };
  }

  // Persist the customer's preferred contact channel in its OWN isolated
  // update so it can never break the core intake submission above. The DB
  // CHECK constraint only allows 'whatsapp'/'sms' AFTER migration 035 is
  // applied — if it's not yet applied, this update is rejected and we simply
  // swallow the error (the rest of the submission already succeeded).
  let updatedRow = data;
  if (preferred) {
    const prefRow = await updatePreferredContactMethod(supabase, customer.id, customer.business_id, preferred);
    if (prefRow) {
      updatedRow = prefRow;
    }
  }

  // postal_code / region (migration 053) in their OWN isolated update so a
  // pre-053 deployment can't fail the core intake submission above. Write only
  // the field(s) the customer actually filled — never null out a prefilled
  // value because the other field was left blank.
  let extras = await loadCustomerExtras(supabase, customer.id, customer.business_id);
  if (postalCode || region) {
    const extraUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (postalCode) extraUpdate.postal_code = postalCode;
    if (region) extraUpdate.region = region;
    await updateCustomerExtras(supabase, customer.id, customer.business_id, extraUpdate);
    extras = { postalCode: postalCode ?? extras.postalCode, region: region ?? extras.region };
  }

  await markIntakeTokenSubmitted(tokenRow.id);

  // Surface the customer's free-text comment as an INBOUND message so it
  // threads into the customer timeline (same pattern as offer/appointment
  // -response). Best-effort & non-fatal — the intake submission already
  // succeeded, so a failure here must not turn it into an error.
  if (comments) {
    const summary = `Σχόλιο από αίτημα στοιχείων: ${comments.slice(0, 1000)}`;
    await insertInboundComment(supabase, {
      business_id: customer.business_id,
      customer_id: customer.id,
      channel: inboundChannel(tokenRow.sent_channel),
      direction: 'inbound',
      status: 'completed',
      phone: null,
      summary,
    });
    if (notifyOwner) {
      // Not a chat message — say what actually happened, with the customer's name.
      const custName = (updatedRow as { name?: string | null } | null)?.name?.trim();
      await notifyOwner(customer.business_id, {
        title: 'Ο πελάτης έστειλε στοιχεία',
        body: `Ο πελάτης ${custName || ''} συμπλήρωσε τη φόρμα στοιχείων. Σχόλιο: ${comments.slice(0, 500)}`.replace('  ', ' '),
        url: `/customers/${customer.id}`,
        data: { type: 'customer_message', source: 'intake' },
      });
    }
  }

  return { kind: 'ok', customer: publicCustomer(updatedRow, extras) };
}
