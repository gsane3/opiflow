// Server-only helper for phone number pool operations.
// Calls the public.assign_available_phone_number SQL function via service_role RPC.
// Returns only safe, non-sensitive data. Provider refs, notes, internal pool details,
// and SIP credentials are never returned or logged.
// Safe to call after business creation. If no number is available, or if an
// unexpected error occurs, assigned is false and business creation is not affected.

import { createServerSupabaseClient } from '@/lib/supabase/server';

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

export interface PhoneAssignmentResult {
  assigned: boolean;
  e164Number: string | null;
  managedPhoneNumberId: string | null;
}

// assignPhoneNumber calls the atomic SQL assignment function.
// The caller is responsible for providing a service-role Supabase client.
// The function is idempotent: if the business already has an active number,
// the existing assignment is returned without creating a duplicate.
// city is optional: when provided and non-empty the SQL function prefers a
// city-matched number; when absent or blank it falls back to the global pool.
export async function assignPhoneNumber(
  supabase: SupabaseClient,
  businessId: string,
  city?: string | null
): Promise<PhoneAssignmentResult> {
  const trimmedCity = typeof city === 'string' ? city.trim() : null;
  try {
    const { data, error } = await supabase.rpc('assign_available_phone_number', {
      p_business_id: businessId,
      p_city: trimmedCity && trimmedCity.length > 0 ? trimmedCity : null,
    });

    if (error) {
      // Do not expose DB error details. Return unassigned so the caller can
      // proceed with business creation without interruption.
      return { assigned: false, e164Number: null, managedPhoneNumberId: null };
    }

    // RETURNS TABLE from Postgres comes back as an array of rows via Supabase JS.
    const rows = data as unknown as Array<{
      assigned: boolean;
      managed_phone_number_id: string | null;
      e164_number: string | null;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      return { assigned: false, e164Number: null, managedPhoneNumberId: null };
    }

    const row = rows[0];
    return {
      assigned: row.assigned === true,
      e164Number: typeof row.e164_number === 'string' ? row.e164_number : null,
      managedPhoneNumberId:
        typeof row.managed_phone_number_id === 'string' ? row.managed_phone_number_id : null,
    };
  } catch {
    // Unexpected error. Return unassigned so business creation is not blocked.
    return { assigned: false, e164Number: null, managedPhoneNumberId: null };
  }
}
