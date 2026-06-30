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
  // email (RESEND_API_KEY/EMAIL_FROM) intentionally NOT tracked here: links are
  // delivered via Viber→SMS, so email is not used. The send-channel still falls
  // back gracefully if a row ever has email as its preferred channel.
  viber: ['APIFON_CLIENT_ID', 'APIFON_API_KEY'],
  telephony: ['PHONE_SIP_WSS_URL', 'PHONE_SIP_USERNAME', 'PHONE_SIP_PASSWORD'],
  // Per-user SIP provisioning switch: when set (a valid 32-byte key), the browser
  // phone is issued each business's OWN SIP credential instead of the shared env one.
  sipPerUser: ['SIP_CRED_ENC_KEY'],
  webhookSecrets: ['PBX_WEBHOOK_SECRET', 'APIFON_WEBHOOK_SECRET'],
  // Stripe billing — when unset, the billing UI hides its upgrade/manage buttons.
  // All three are required for checkout AND activation to actually work, so health
  // only reports billing:true when payments can really function end-to-end.
  // (Native `push` is reported separately by /api/health via isPushEnabled().)
  billing: ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID', 'STRIPE_WEBHOOK_SECRET'],
  // Sentry error monitoring — when set, instrumentation.ts initialises the
  // server SDK and next.config wraps the build with withSentryConfig.
  monitoring: ['SENTRY_DSN'],
  // Twilio Programmable Voice — native in-app calling (the /api/phone/twilio-token
  // endpoint mints Voice access tokens). Inert until all four are set.
  twilioVoice: ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_TWIML_APP_SID'],
  // AADE / myDATA e-invoicing via the accredited provider (SBZ). ONE partner
  // API key issues for many tenant ΑΦΜ (per-doc issuer set in the XML). When unset,
  // the invoicing UI/routes stay dormant (503 invoicing_not_configured) and health
  // reports invoicing:false. Per-tenant activation is a separate DB flag.
  // (Optional SBZ_API_MODE = sandbox|production, default production.)
  invoicing: ['SBZ_API_KEY', 'SBZ_API_BASE_URL'],
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

/**
 * For each optional integration that is NOT fully configured, the env var NAMES
 * still missing. Names only — never values — so this is safe to expose on the
 * health probe to debug "why is integration X off?" without leaking secrets.
 */
export function missingIntegrationEnv(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, keys] of Object.entries(OPTIONAL_INTEGRATIONS)) {
    const missing = keys.filter((k) => !process.env[k]);
    if (missing.length > 0) out[name] = missing;
  }
  return out;
}
