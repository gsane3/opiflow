// Customers — DB row + API DTO types (reference module, PR-1).
// Mirrors the shapes the live `/api/customers` route already returns, so a future
// migration to this module is a 1:1 swap with no client-visible change.

/** The columns selected for a customer (kept identical to the live route). */
export const CUSTOMER_COLUMNS = [
  'id', 'crm_number', 'name', 'company_name', 'phone', 'mobile_phone',
  'landline_phone', 'email', 'address', 'source', 'status',
  'opportunity_value', 'needs_summary', 'notes', 'preferred_contact_method',
  'intake_status', 'last_contact_at', 'created_at', 'updated_at',
  'status_summary', 'business_notes', 'personal_notes', 'next_best_action', 'memory_updated_at',
].join(', ');

/** A row as it comes back from Postgres (snake_case). */
export interface CustomerRow {
  id: string;
  crm_number: string | null;
  name: string | null;
  company_name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  status: string;
  opportunity_value: number | null;
  needs_summary: string | null;
  notes: string | null;
  preferred_contact_method: string;
  intake_status: string;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
  status_summary: string | null;
  business_notes: string | null;
  personal_notes: string | null;
  next_best_action: string | null;
  memory_updated_at: string | null;
}

/**
 * Detail row for /api/customers/[id] — the core columns plus the migration-gated
 * extras read tolerantly (pinned 044, postal/region/imported 053, blocked 058).
 * They are optional because the core CUSTOMER_COLUMNS select doesn't include them.
 */
export interface CustomerDetailRow extends CustomerRow {
  pinned?: boolean;
  postal_code?: string | null;
  region?: string | null;
  imported_from_phone?: boolean | null;
  blocked?: boolean | null;
  vat_number?: string | null;
}

/** The camelCase DTO returned to web/native clients. */
export interface Customer {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  status: string;
  opportunityValue: number | null;
  needsSummary: string | null;
  notes: string | null;
  preferredContactMethod: string;
  intakeStatus: string;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  statusSummary: string | null;
  businessNotes: string | null;
  personalNotes: string | null;
  nextBestAction: string | null;
  memoryUpdatedAt: string | null;
}

/**
 * The DTO returned by /api/customers/[id] — the list DTO plus the detail-only fields,
 * IN THE SAME KEY ORDER the live route emits (postalCode/region/importedFromPhone/blocked
 * after address; nextTaskId after updatedAt; pinned last) so the JSON body is byte-identical.
 */
export interface CustomerDetail {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  postalCode: string | null;
  region: string | null;
  importedFromPhone: boolean;
  blocked: boolean;
  /** End-customer ΑΦΜ (migration 067) — drives B2B 2.1 vs B2C 11.2 invoicing. */
  vatNumber: string | null;
  source: string | null;
  status: string;
  opportunityValue: number | null;
  needsSummary: string | null;
  notes: string | null;
  preferredContactMethod: string;
  intakeStatus: string;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
  nextTaskId: string | null;
  statusSummary: string | null;
  businessNotes: string | null;
  personalNotes: string | null;
  nextBestAction: string | null;
  memoryUpdatedAt: string | null;
  pinned: boolean;
}
