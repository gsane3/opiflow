// Offers — DB row + API DTO types (reference module). Mirrors /api/offers.

export const OFFER_COLUMNS = [
  'id', 'business_id', 'customer_id', 'related_task_id', 'related_call_id',
  'offer_number', 'status', 'offer_date', 'valid_until',
  'subtotal', 'vat_rate', 'vat_amount', 'total',
  'notes', 'terms', 'acceptance_text', 'viber_draft',
  'email_subject', 'email_body', 'created_from_ai',
  'created_at', 'updated_at',
].join(', ');

export const ITEM_COLUMNS = [
  'id', 'business_id', 'offer_id', 'description', 'quantity',
  'unit_price', 'line_total', 'sort_order', 'created_at', 'updated_at',
].join(', ');

export interface OfferRow {
  id: string;
  business_id: string;
  customer_id: string | null;
  related_task_id: string | null;
  related_call_id: string | null;
  offer_number: string;
  status: string;
  offer_date: string;
  valid_until: string | null;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  acceptance_text: string | null;
  viber_draft: string | null;
  email_subject: string | null;
  email_body: string | null;
  created_from_ai: boolean;
  created_at: string;
  updated_at: string;
}

export interface OfferItemRow {
  id: string;
  business_id: string;
  offer_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface OfferItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface Offer {
  id: string;
  customerId: string | null;
  relatedTaskId: string | null;
  relatedCallId: string | null;
  offerNumber: string;
  status: string;
  offerDate: string;
  validUntil: string | null;
  items: OfferItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  acceptanceText: string | null;
  viberDraft: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  createdFromAi: boolean;
  createdAt: string;
  updatedAt: string;
}
