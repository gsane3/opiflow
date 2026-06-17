// Multiple bank accounts per business (α). Service-role only; every query is
// scoped by business_id. The PRIMARY account (lowest sort_order) is mirrored into
// businesses.bank_* via syncPrimaryBank, so the payment-request / portal / offer
// read paths keep reading the single columns unchanged. Requires migration 051;
// callers should treat a thrown error as "feature unavailable" (pre-051).

import { createServiceSupabaseClient } from './intake-tokens';

export interface BankAccount {
  id: string;
  beneficiary: string | null;
  bankName: string | null;
  iban: string;
  sortOrder: number;
}
interface Row {
  id: string;
  beneficiary: string | null;
  bank_name: string | null;
  iban: string;
  sort_order: number;
}
const COLS = 'id, beneficiary, bank_name, iban, sort_order';
const map = (r: Row): BankAccount => ({ id: r.id, beneficiary: r.beneficiary, bankName: r.bank_name, iban: r.iban, sortOrder: r.sort_order });

export interface BankAccountInput {
  beneficiary: string | null;
  bankName: string | null;
  iban: string;
}

export async function listBankAccounts(businessId: string): Promise<BankAccount[]> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('business_bank_accounts')
    .select(COLS)
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(map);
}

/**
 * Mirror the PRIMARY account (lowest sort_order) into businesses.bank_* so every
 * existing read site (payment-request, portal, offer PDF) keeps working unchanged.
 * Clearing all accounts clears the mirror. Best-effort within callers.
 */
export async function syncPrimaryBank(businessId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { data } = await supabase
    .from('business_bank_accounts')
    .select('beneficiary, bank_name, iban')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const p = (data as { beneficiary: string | null; bank_name: string | null; iban: string } | null) ?? null;
  await supabase
    .from('businesses')
    .update({ bank_beneficiary: p?.beneficiary ?? null, bank_name: p?.bank_name ?? null, bank_iban: p?.iban ?? null })
    .eq('id', businessId);
}

export async function createBankAccount(businessId: string, v: BankAccountInput): Promise<BankAccount> {
  const supabase = createServiceSupabaseClient();
  const { data: maxRow } = await supabase
    .from('business_bank_accounts')
    .select('sort_order')
    .eq('business_id', businessId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow as { sort_order?: number } | null)?.sort_order ?? -1) + 1;
  const { data, error } = await supabase
    .from('business_bank_accounts')
    .insert({ business_id: businessId, beneficiary: v.beneficiary, bank_name: v.bankName, iban: v.iban, sort_order: nextOrder })
    .select(COLS)
    .single();
  if (error) throw error;
  await syncPrimaryBank(businessId);
  return map(data as unknown as Row);
}

export async function updateBankAccount(businessId: string, id: string, v: BankAccountInput): Promise<BankAccount | null> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from('business_bank_accounts')
    .update({ beneficiary: v.beneficiary, bank_name: v.bankName, iban: v.iban, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('business_id', businessId)
    .select(COLS)
    .maybeSingle();
  if (error) throw error;
  await syncPrimaryBank(businessId);
  return data ? map(data as unknown as Row) : null;
}

export async function deleteBankAccount(businessId: string, id: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from('business_bank_accounts')
    .delete()
    .eq('id', id)
    .eq('business_id', businessId);
  if (error) throw error;
  await syncPrimaryBank(businessId);
}
