import {
  createServiceSupabaseClient,
  findValidIntakeToken,
  markIntakeTokenOpened,
} from '@/lib/server/intake-tokens';
import IntakeFormClient, { IntakeCustomer } from './IntakeFormClient';

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

async function getInitialCustomer(token: string): Promise<{
  customer: IntakeCustomer | null;
  error: string | null;
}> {
  try {
    const tokenRow = await findValidIntakeToken(token);

    if (!tokenRow) {
      return {
        customer: null,
        error: 'Ο σύνδεσμος δεν είναι διαθέσιμος ή έχει λήξει.',
      };
    }

    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .eq('id', tokenRow.customer_id)
      .eq('business_id', tokenRow.business_id)
      .maybeSingle();

    if (error || !data) {
      return {
        customer: null,
        error: 'Δεν μπορέσαμε να φορτώσουμε τη φόρμα. Δοκιμάστε ξανά.',
      };
    }

    await markIntakeTokenOpened(tokenRow.id);

    return {
      customer: publicCustomer(asCustomerRow(data)),
      error: null,
    };
  } catch {
    return {
      customer: null,
      error: 'Δεν μπορέσαμε να φορτώσουμε τη φόρμα. Δοκιμάστε ξανά.',
    };
  }
}

export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const initial = await getInitialCustomer(token);

  return (
    <IntakeFormClient
      token={token}
      initialCustomer={initial.customer}
      initialError={initial.error}
    />
  );
}
