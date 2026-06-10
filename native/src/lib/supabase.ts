import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Same Supabase project as the web app. URL is public; the anon key is also a
// public client key (it ships in every web bundle), provided via an Expo public
// env var so it isn't hard-coded. Create native/.env with:
//   EXPO_PUBLIC_SUPABASE_ANON_KEY=...   (Supabase dashboard → Settings → API → anon public)
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://oluhmztfimmgmbxoioea.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** True only when the anon key is configured (so the UI can warn instead of failing silently). */
export const isSupabaseConfigured = SUPABASE_ANON_KEY.length > 0;
