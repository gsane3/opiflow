import {
  createServiceSupabaseClient,
  findValidIntakeToken,
  markIntakeTokenOpened,
} from '@/lib/server/intake-tokens';
import IntakeFormClient, { IntakeBusiness, IntakeCustomer } from './IntakeFormClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CUSTOMER_COLUMNS = [
  'id',
  'business_id',
  'crm_number',
  'name',
  'company_name',
  'phone',
  'mobile_phone',
  'landline_phone',
  'email',
  'address',
  'needs_summary',
  'notes',
  'intake_status',
].join(', ');

interface CustomerRow {
  id: string;
  business_id: string;
  crm_number: string | null;
  name: string | null;
  company_name: string | null;
  phone: string | null;
  mobile_phone: string | null;
  landline_phone: string | null;
  email: string | null;
  address: string | null;
  needs_summary: string | null;
  notes: string | null;
  intake_status: string;
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function asCustomerRow(value: unknown): CustomerRow {
  return value as CustomerRow;
}

function publicCustomer(row: CustomerRow): IntakeCustomer {
  return {
    crmNumber: row.crm_number,
    displayName: row.name ?? row.company_name ?? row.crm_number ?? 'Πελάτης',
    phoneMasked: maskPhone(row.phone ?? row.mobile_phone ?? row.landline_phone),
    email: row.email,
    address: row.address,
    notes: row.notes,
    needsSummary: row.needs_summary,
    intakeStatus: row.intake_status,
  };
}

// Public business header (logo + name + contact) — the brand the customer sees.
const BUSINESS_COLUMNS = ['name', 'legal_name', 'trade_name', 'logo_url', 'phone', 'email', 'website'].join(', ');

interface BusinessRow {
  name: string | null;
  legal_name: string | null;
  trade_name: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}

function publicBusiness(row: BusinessRow | null): IntakeBusiness | null {
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

async function getInitialCustomer(token: string): Promise<{
  customer: IntakeCustomer | null;
  business: IntakeBusiness | null;
  error: string | null;
}> {
  try {
    const tokenRow = await findValidIntakeToken(token);

    if (!tokenRow) {
      return {
        customer: null,
        business: null,
        error: 'Ο σύνδεσμος δεν είναι διαθέσιμος ή έχει λήξει.',
      };
    }

    const supabase = createServiceSupabaseClient();
    const [{ data, error }, { data: bizData }] = await Promise.all([
      supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .eq('id', tokenRow.customer_id)
        .eq('business_id', tokenRow.business_id)
        .maybeSingle(),
      supabase
        .from('businesses')
        .select(BUSINESS_COLUMNS)
        .eq('id', tokenRow.business_id)
        .maybeSingle(),
    ]);

    if (error || !data) {
      return {
        customer: null,
        business: null,
        error: 'Δεν μπορέσαμε να φορτώσουμε τη φόρμα. Δοκιμάστε ξανά.',
      };
    }

    await markIntakeTokenOpened(tokenRow.id);

    return {
      customer: publicCustomer(asCustomerRow(data)),
      business: publicBusiness((bizData as unknown as BusinessRow | null) ?? null),
      error: null,
    };
  } catch {
    return {
      customer: null,
      business: null,
      error: 'Δεν μπορέσαμε να φορτώσουμε τη φόρμα. Δοκιμάστε ξανά.',
    };
  }
}

export default async function IntakePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ submitted?: string }>;
}) {
  const { token } = await params;
  const query = searchParams ? await searchParams : {};
  const initialSubmitted = query.submitted === '1';

  if (initialSubmitted) {
    return (
      <IntakeFormClient
        token={token}
        initialCustomer={null}
        initialError={null}
        initialSubmitted
      />
    );
  }

  const initial = await getInitialCustomer(token);

  return (
    <IntakeFormClient
      token={token}
      initialCustomer={initial.customer}
      initialBusiness={initial.business}
      initialError={initial.error}
    />
  );
}
