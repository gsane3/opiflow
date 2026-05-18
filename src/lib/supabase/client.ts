// Browser-safe Supabase client.
// Uses the public anon key. Data access is enforced by Row Level Security (RLS).
// Do NOT import SUPABASE_SERVICE_ROLE_KEY in this file.

import { createClient } from '@supabase/supabase-js';

export function createBrowserSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase browser environment variables. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}
