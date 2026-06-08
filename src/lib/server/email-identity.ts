// ---------------------------------------------------------------------------
// Per-business email sender identity (Phase 1).
//
// Phase 1 keeps the verified Opiflow domain as the technical sender but presents
// each business's OWN name to the customer, and routes replies to the business's
// own inbox — no per-business DNS or OAuth required. This is enough because email
// is the FALLBACK channel (after Viber/SMS).
//
//   from:     "<Business> via Opiflow <noreply@opiflow.gr>"  (display name swap)
//   reply_to: the business's own email when set, else the global EMAIL_REPLY_TO
//
// Phase 2 (future, NOT built): "Connect Gmail/Outlook" via OAuth (Gmail API /
// Microsoft Graph) to send genuinely from the owner's mailbox. Large effort
// incl. Google sensitive-scope verification — see PROJECT_STATE.md loose ends.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Extract the bare address from an RFC 5322 `from` value, which may be either
 * `addr@domain` or `Display Name <addr@domain>`.
 */
export function extractEmailAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  return (angled ? angled[1] : from).trim();
}

/**
 * Strip characters that would break the structure of an email display name
 * (header injection, address-list delimiters, quoting). Greek / UTF-8 letters
 * pass through unchanged — Resend MIME-encodes them on send.
 */
function sanitizeDisplayName(name: string): string {
  return name
    .replace(/[\r\n"\\<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build the Resend `from` header for a given business.
 *
 * Presents the business name over the verified Opiflow sending address, e.g.
 *   "Τεχνική Σάνε via Opiflow <noreply@opiflow.gr>"
 * The display name is quoted so a comma / semicolon inside a business name can't
 * be mis-parsed as an address-list separator. Falls back to the raw `fromEnv`
 * when no business name is available (or no address can be extracted).
 */
export function buildBusinessFromHeader(
  businessName: string | null | undefined,
  fromEnv: string
): string {
  const address = extractEmailAddress(fromEnv);
  const clean = businessName ? sanitizeDisplayName(businessName) : '';
  if (!clean || !address) return fromEnv;
  return `"${clean} via Opiflow" <${address}>`;
}

/**
 * Resolve the Resend `reply_to`: prefer the business's own email so customer
 * replies reach the business directly; fall back to the global EMAIL_REPLY_TO.
 * Returns null when neither is a valid/non-empty address (Resend then defaults
 * replies to `from`).
 */
export function resolveReplyTo(
  businessEmail: string | null | undefined,
  replyToEnv: string | null | undefined
): string | null {
  const own = businessEmail?.trim();
  if (own && EMAIL_RE.test(own)) return own;
  const fallback = replyToEnv?.trim();
  if (fallback) return fallback;
  return null;
}
