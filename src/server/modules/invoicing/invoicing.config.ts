// Invoicing env gating — mirrors src/lib/billing/stripe.ts isStripeConfigured().
// Read lazily (inside calls, never at module load) so the build never needs the
// SBZ env vars. SBZ uses a SINGLE partner API key (one credential, issuer set per
// document via the XML issuer VAT); per-tenant activation is a DB flag.
//
// Env (set by the owner in Vercel):
//   SBZ_API_KEY        — the SBZ partner API-KEY (sent as the `API-KEY` header)
//   SBZ_API_BASE_URL   — e.g. https://api.sbz.gr
//   SBZ_API_MODE       — 'sandbox' | 'production' (optional, default 'production')

export interface SbzConfig {
  apiKey: string;
  baseUrl: string;
  mode: 'production' | 'sandbox';
}

/** True only when the SBZ partner env is present (matches env.ts `invoicing`). */
export function isInvoicingConfigured(): boolean {
  return Boolean(process.env.SBZ_API_KEY && process.env.SBZ_API_BASE_URL);
}

/** The SBZ partner config, or null when not fully configured. Never logs the key. */
export function getSbzConfig(): SbzConfig | null {
  const apiKey = process.env.SBZ_API_KEY;
  const baseUrl = process.env.SBZ_API_BASE_URL;
  if (!apiKey || !baseUrl) return null;
  const mode: 'production' | 'sandbox' = process.env.SBZ_API_MODE === 'sandbox' ? 'sandbox' : 'production';
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), mode };
}
