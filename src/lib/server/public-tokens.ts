// Shared primitives for the public customer-link/token system (intake, upload,
// offer-response, appointment-response — and, soon, the Work Folder link).
//
// These were previously duplicated verbatim across the four *-tokens.ts modules.
// They are centralised here so every public link uses ONE token format and ONE
// hashing/URL convention. The per-type modules re-export thin wrappers so their
// existing public API (and therefore every existing link) is unchanged.
//
// Security model is unchanged: the raw token is NEVER stored — only its SHA-256
// hex hash is written to the DB and compared on lookup. The service-role client
// bypasses RLS, so every caller must still scope queries by business_id.

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// 32 random bytes → 43-char base64url string. DO NOT change: altering the byte
// count or encoding would change the token format and invalidate live links.
const TOKEN_BYTES = 32;

interface ServerEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function requireServerEnv(): ServerEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase server env (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)');
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
}

/**
 * Service-role Supabase client (bypasses RLS). Server-only — never expose the
 * service-role key to the browser. Every query must be scoped by business_id.
 */
export function createServiceSupabaseClient() {
  const env = requireServerEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A new random public token (the raw value — never stored, only its hash is). */
export function generateRawToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex hash of a raw token — the value stored in and compared against the DB. */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Public app origin (no trailing slash) used to build customer-facing links. */
export function getPublicAppUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (appUrl) {
    return appUrl.replace(/\/$/, '');
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return 'http://localhost:3000';
}

/**
 * Build a public token URL of the form `${origin}/${segment}/${encodedToken}`,
 * e.g. buildPublicTokenUrl('intake', raw) → https://app/intake/<raw>.
 */
export function buildPublicTokenUrl(segment: string, rawToken: string): string {
  return `${getPublicAppUrl()}/${segment}/${encodeURIComponent(rawToken)}`;
}
