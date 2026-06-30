// Invoicing env gating — mirrors src/lib/billing/stripe.ts isStripeConfigured().
// Read lazily (inside calls, never at module load) so the build never needs the
// SBZ env vars. The SBZ partner credentials are ONE pair shared across all tenant
// ΑΦΜ (per-doc issuer is set via issuervat); per-tenant activation is a DB flag.

export interface SbzConfig {
  userId: string;
  subscriptionKey: string;
  baseUrl: string;
}

/** True only when ALL SBZ partner env vars are present (matches env.ts `invoicing`). */
export function isInvoicingConfigured(): boolean {
  return Boolean(
    process.env.SBZ_API_USER_ID &&
      process.env.SBZ_API_SUBSCRIPTION_KEY &&
      process.env.SBZ_API_BASE_URL
  );
}

/** The SBZ partner config, or null when not fully configured. Never logs the key. */
export function getSbzConfig(): SbzConfig | null {
  const userId = process.env.SBZ_API_USER_ID;
  const subscriptionKey = process.env.SBZ_API_SUBSCRIPTION_KEY;
  const baseUrl = process.env.SBZ_API_BASE_URL;
  if (!userId || !subscriptionKey || !baseUrl) return null;
  return { userId, subscriptionKey, baseUrl: baseUrl.replace(/\/+$/, '') };
}
