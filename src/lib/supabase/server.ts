// Server-only Supabase admin client.
// Uses SUPABASE_SERVICE_ROLE_KEY which bypasses Row Level Security (RLS).
// NEVER import or call this file from browser code or client components.
// NEVER use NEXT_PUBLIC_ prefix on SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from '@supabase/supabase-js';

export function createServerSupabaseClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createServerSupabaseClient must only be used on the server.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase server environment variables. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
