// Centralized environment access + validation.
// Fail fast on missing required vars; expose a booleans-only summary for health
// checks. Never log or return secret values.

export const REQUIRED_SERVER_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export const OPTIONAL_INTEGRATIONS: Record<string, readonly string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  email: ['RESEND_API_KEY', 'EMAIL_FROM'],
  viber: ['APIFON_CLIENT_ID', 'APIFON_API_KEY'],
  telephony: ['PHONE_SIP_WSS_URL', 'PHONE_SIP_USERNAME', 'PHONE_SIP_PASSWORD'],
  webhookSecrets: ['PBX_WEBHOOK_SECRET', 'APIFON_WEBHOOK_SECRET'],
};

/** Throws if a required env var is missing. Use at the top of code paths that need it. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** Returns the list of missing required server env vars (empty == healthy). */
export function missingRequiredEnv(): string[] {
  return REQUIRED_SERVER_ENV.filter((k) => !process.env[k]);
}

/** Booleans-only summary of which optional integrations are fully configured. */
export function integrationStatus(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [name, keys] of Object.entries(OPTIONAL_INTEGRATIONS)) {
    out[name] = keys.every((k) => !!process.env[k]);
  }
  return out;
}
