// Customers — service (business logic), reference module, PR-1.
//
// The service validates input (Zod), normalizes it, orchestrates the repo, and maps
// rows to the client DTO. It NEVER touches Supabase directly (that's the repo's job)
// and NEVER builds HTTP responses (that's the route's job). Imported by no live
// route yet → zero runtime change.

import { CreateCustomerSchema, ListCustomersQuerySchema } from './customers.schema';
import { type Customer, type CustomerRow } from './customers.types';
import {
  insertCustomerRow,
  listCustomerRows,
  takeNextCrmNumber,
  type RepoContext,
} from './customers.repo';

/** Greek-aware phone normalization to +30 E.164 (parity with the live route). */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return s; // unknown / non-Greek: cleaned, not rejected
}

/** Maps a DB row (snake_case) to the client DTO (camelCase). */
export function dbToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    crmNumber: row.crm_number,
    name: row.name,
    companyName: row.company_name,
    phone: row.phone,
    mobilePhone: row.mobile_phone,
    landlinePhone: row.landline_phone,
    email: row.email,
    address: row.address,
    source: row.source,
    status: row.status,
    opportunityValue: row.opportunity_value,
    needsSummary: row.needs_summary,
    notes: row.notes,
    preferredContactMethod: row.preferred_contact_method,
    intakeStatus: row.intake_status,
    lastContactAt: row.last_contact_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    statusSummary: row.status_summary,
    businessNotes: row.business_notes,
    personalNotes: row.personal_notes,
    nextBestAction: row.next_best_action,
    memoryUpdatedAt: row.memory_updated_at,
  };
}

/** List customers for the caller's business. Throws ZodError on a bad query. */
export async function listCustomers(
  ctx: RepoContext,
  rawQuery: unknown,
): Promise<Customer[]> {
  const query = ListCustomersQuerySchema.parse(rawQuery);
  const rows = await listCustomerRows(ctx, query);
  return rows.map(dbToCustomer);
}

/** Create a customer. Throws ZodError on invalid input (→ 400 via handleApiError). */
export async function createCustomer(
  ctx: RepoContext,
  rawInput: unknown,
): Promise<Customer> {
  const input = CreateCustomerSchema.parse(rawInput);
  const crmNumber = await takeNextCrmNumber(ctx);

  const row = await insertCustomerRow(ctx, {
    crm_number: crmNumber,
    name: input.name ?? null,
    company_name: input.companyName ?? null,
    phone: normalizePhone(input.phone),
    mobile_phone: normalizePhone(input.mobilePhone),
    landline_phone: normalizePhone(input.landlinePhone),
    email: input.email ?? null,
    address: input.address ?? null,
    source: input.source ?? 'manual_entry',
    status: input.status ?? 'new',
    opportunity_value: input.opportunityValue ?? null,
    needs_summary: input.needsSummary ?? null,
    notes: input.notes ?? null,
    preferred_contact_method: input.preferredContactMethod ?? 'phone',
    intake_status: input.intakeStatus ?? 'none',
  });

  return dbToCustomer(row);
}
