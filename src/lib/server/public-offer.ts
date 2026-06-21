// Public, customer-facing read of a single OFFER for /f/[token]/offer/[offerId].
//
// SECURITY: triple-scoped to the folder token (business_id + work_folder_id +
// offer id). Returns ONLY safe, customer-facing offer + business-branding fields
// — exactly what belongs on a printed offer the customer already receives. NEVER
// returns internal ids, viber_draft / email_* drafts, or any other customer's
// data. Fail-closed: any invalid/expired/revoked token, an offer that is not in
// THIS folder, or any DB error → null (the page shows a neutral message).

import { createServiceSupabaseClient } from './intake-tokens';
import { findValidFolderToken } from './folder-tokens';

const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Σε ετοιμασία',
  ready_to_send: 'Σε ετοιμασία',
  sent_manually: 'Στάλθηκε',
  sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
  cancelled: 'Ακυρώθηκε',
};

export interface PublicOfferLine {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}
export interface PublicOfferBusiness {
  logoUrl: string | null;
  primaryName: string;
  tradeName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLines: string[];
  vatNumber: string | null;
  taxOffice: string | null;
  bankBeneficiary: string | null;
  bankName: string | null;
  bankIban: string | null;
}
export interface PublicOfferCustomer {
  name: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  addressLines: string[];
}
export interface PublicOfferView {
  offerNumber: string;
  statusLabel: string;
  offerDate: string | null;
  validUntil: string | null;
  items: PublicOfferLine[];
  subtotal: number | null;
  vatRate: number | null;
  vatAmount: number | null;
  total: number | null;
  notes: string | null;
  terms: string | null;
  acceptanceText: string | null;
  business: PublicOfferBusiness | null;
  customer: PublicOfferCustomer | null;
}

interface OfferRow {
  offer_number: string | null;
  status: string;
  offer_date: string | null;
  valid_until: string | null;
  subtotal: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  total: number | null;
  notes: string | null;
  terms: string | null;
  acceptance_text: string | null;
  customer_id: string | null;
}
interface CustomerRow {
  name: string | null;
  company_name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  email: string | null;
  address: string | null;
}
interface ItemRow {
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  sort_order: number | null;
}
interface BizRow {
  name: string | null;
  legal_name: string | null;
  trade_name: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  vat_number: string | null;
  tax_office: string | null;
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  region: string | null;
  bank_beneficiary: string | null;
  bank_name: string | null;
  bank_iban: string | null;
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function mapBusiness(b: BizRow | null): PublicOfferBusiness | null {
  if (!b) return null;
  const primaryName = b.legal_name?.trim() || b.name?.trim() || b.trade_name?.trim() || 'Η επιχείρηση';
  const trade = b.trade_name?.trim();
  const postalCity = [b.postal_code, b.city].filter(Boolean).join(' ').trim();
  const addressLines = [b.address_line1 || b.address, b.address_line2, postalCity || null, b.region]
    .map((s) => (s ? String(s).trim() : ''))
    .filter((s) => s.length > 0);
  return {
    logoUrl: b.logo_url,
    primaryName,
    tradeName: trade && trade !== primaryName ? trade : null,
    phone: b.phone,
    email: b.email,
    website: b.website,
    addressLines,
    vatNumber: b.vat_number,
    taxOffice: b.tax_office,
    bankBeneficiary: b.bank_beneficiary?.trim() || null,
    bankName: b.bank_name?.trim() || null,
    bankIban: b.bank_iban?.trim() || null,
  };
}

export async function loadPublicOffer(rawToken: string, offerId: string): Promise<PublicOfferView | null> {
  try {
    const token = await findValidFolderToken(rawToken);
    if (!token) return null;

    const supabase = createServiceSupabaseClient();

    // Offer — triple-scoped: must belong to THIS business AND THIS folder.
    const offerRes = await supabase
      .from('offers')
      .select('offer_number, status, offer_date, valid_until, subtotal, vat_rate, vat_amount, total, notes, terms, acceptance_text, customer_id')
      .eq('id', offerId)
      .eq('business_id', token.business_id)
      .eq('work_folder_id', token.work_folder_id)
      .maybeSingle();
    if (offerRes.error || !offerRes.data) return null;
    const o = offerRes.data as unknown as OfferRow;

    const [itemsRes, bizRes, custRes] = await Promise.all([
      supabase
        .from('offer_items')
        .select('description, quantity, unit_price, line_total, sort_order')
        .eq('offer_id', offerId)
        .eq('business_id', token.business_id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('businesses')
        .select('name, legal_name, trade_name, logo_url, phone, email, website, vat_number, tax_office, address, address_line1, address_line2, postal_code, city, region, bank_beneficiary, bank_name, bank_iban')
        .eq('id', token.business_id)
        .maybeSingle(),
      // Recipient (customer) — scoped to THIS business; safe contact fields only.
      o.customer_id
        ? supabase
            .from('customers')
            .select('name, company_name, phone, mobile_phone, email, address')
            .eq('id', o.customer_id)
            .eq('business_id', token.business_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const itemRows = ((itemsRes.data ?? []) as unknown[]) as ItemRow[];
    const items: PublicOfferLine[] = itemRows.map((r) => ({
      description: (r.description ?? '').trim(),
      quantity: num(r.quantity),
      unitPrice: num(r.unit_price),
      lineTotal: num(r.line_total),
    }));

    return {
      offerNumber: o.offer_number ?? '—',
      statusLabel: OFFER_STATUS_LABELS[o.status] ?? o.status,
      offerDate: o.offer_date,
      validUntil: o.valid_until,
      items,
      subtotal: o.subtotal,
      vatRate: o.vat_rate,
      vatAmount: o.vat_amount,
      total: o.total,
      notes: o.notes?.trim() || null,
      terms: o.terms?.trim() || null,
      acceptanceText: o.acceptance_text?.trim() || null,
      business: mapBusiness((bizRes.data as unknown as BizRow | null) ?? null),
      customer: mapCustomer((custRes.data as unknown as CustomerRow | null) ?? null),
    };
  } catch {
    return null;
  }
}

function mapCustomer(c: CustomerRow | null): PublicOfferCustomer | null {
  if (!c) return null;
  const name = c.name?.trim() || null;
  const companyName = c.company_name?.trim() || null;
  const phone = c.phone?.trim() || c.mobile_phone?.trim() || null;
  const email = c.email?.trim() || null;
  const addressLines = [c.address].map((s) => (s ? String(s).trim() : '')).filter((s) => s.length > 0);
  // Render only when there is at least one populated field.
  if (!name && !companyName && !phone && !email && addressLines.length === 0) return null;
  return { name, companyName, phone, email, addressLines };
}
