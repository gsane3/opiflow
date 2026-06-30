// Invoicing (AADE / myDATA) — pure types + constants. No runtime deps (safe to import
// from tests and the edge). Mirrors the 066_invoicing.sql schema. The provider
// transmission + XML building live in PR2 (mydata-xml.ts / providers/sbz.ts).

export const INVOICE_STATUSES = ['draft', 'submitting', 'issued', 'failed', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const ONBOARDING_STATUSES = ['not_started', 'link_sent', 'gsis_authorized', 'active'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

// myDATA invoiceType enumeration (subset relevant to a service business). Kept as the
// exact AADE string codes so the document builder can pass them through verbatim.
export const INVOICE_TYPES = {
  '1.1': 'Τιμολόγιο Πώλησης',
  '2.1': 'Τιμολόγιο Παροχής Υπηρεσιών',
  '11.1': 'ΑΛΠ (Απόδειξη Λιανικής Πώλησης)',
  '11.2': 'ΑΠΥ (Απόδειξη Παροχής Υπηρεσιών)',
  '5.1': 'Πιστωτικό Τιμολόγιο (συσχετιζόμενο)',
  '5.2': 'Πιστωτικό Τιμολόγιο (μη συσχετιζόμενο)',
} as const;
export type InvoiceTypeCode = keyof typeof INVOICE_TYPES;

// myDATA VAT category codes (vatCategory). 1=24%, 2=13%, 3=6%, 7=0%, 8=records w/o VAT.
export const VAT_CATEGORY = {
  24: 1,
  13: 2,
  6: 3,
  0: 7,
} as const;
export type VatRate = keyof typeof VAT_CATEGORY;

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  /** Unit price NET of VAT. */
  unitNet: number;
  vatRate: number; // 24 | 13 | 6 | 0
  netAmount: number; // quantity * unitNet, rounded
  vatAmount: number;
  /** E3 income classification code, e.g. 'E3_561_001'. */
  incomeClassification?: string;
}

export interface InvoicingSettingsRow {
  id: string;
  business_id: string;
  enabled: boolean;
  provider: string;
  issuer_vat: string | null;
  issuer_branch: number;
  invoice_series: string | null;
  auto_issue_on_payment: boolean;
  default_income_classification: string | null;
  onboarding_status: OnboardingStatus;
  gsis_authorized_at: string | null;
  activated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  work_folder_id: string | null;
  offer_id: string | null;
  payment_request_id: string | null;
  provider: string;
  invoice_type: string;
  series: string | null;
  aa: string | null;
  issue_date: string;
  counterparty_vat: string | null;
  counterparty_name: string | null;
  currency: string;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  line_items: InvoiceLineItem[];
  classification: unknown | null;
  status: InvoiceStatus;
  mark: string | null;
  uid: string | null;
  authentication_code: string | null;
  qr_url: string | null;
  cancellation_mark: string | null;
  dedup_key: string | null;
  provider_request: unknown | null;
  provider_response: unknown | null;
  error: string | null;
  issued_at: string | null;
  created_at: string;
  updated_at: string;
}
