// Google / Apple sign-in via Supabase OAuth + an in-app browser session.
//
// Flow (PKCE): ask Supabase for the provider's authorize URL → open it in an
// SFSafariViewController/Custom Tab → the provider redirects back to
// `opiflow://auth/callback?code=…` → exchange the code for a Supabase session.
// The AuthProvider's onAuthStateChange then picks up SIGNED_IN automatically.
//
// Server-side setup (no app rebuild needed once done): enable the Google + Apple
// providers in Supabase → Authentication → Providers, and add the redirect URL
// `opiflow://auth/callback` under Authentication → URL Configuration. See
// docs/NATIVE_SOCIAL_LOGIN.md.

import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from './supabase';

// Dismisses the auth browser if it's left open when the app is re-focused.
WebBrowser.maybeCompleteAuthSession();

export type SocialProvider = 'google' | 'apple';

export type SocialResult = { ok: true } | { ok: false; cancelled?: boolean; error?: string };

export async function signInWithProvider(provider: SocialProvider): Promise<SocialResult> {
  try {
    // opiflow://auth/callback in a standalone build (exp://… in Expo Go).
    const redirectTo = Linking.createURL('auth/callback');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { ok: false, error: error.message };
    if (!data?.url) return { ok: false, error: 'Δεν επιστράφηκε URL σύνδεσης.' };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { ok: false, cancelled: true };
    }
    if (result.type !== 'success' || !result.url) {
      return { ok: false, error: 'Η σύνδεση δεν ολοκληρώθηκε.' };
    }

    const { queryParams } = Linking.parse(result.url);
    const code = queryParams?.code;
    const oauthError = queryParams?.error_description ?? queryParams?.error;
    if (typeof oauthError === 'string') return { ok: false, error: oauthError };
    if (typeof code !== 'string') return { ok: false, error: 'Λείπει ο κωδικός σύνδεσης.' };

    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) return { ok: false, error: exchangeError.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Άγνωστο σφάλμα.' };
  }
}
