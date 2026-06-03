import { timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of a received webhook secret against the expected
 * value. Both are treated as opaque UTF-8 strings. Returns false immediately on
 * a length mismatch (a minor, acceptable length leak) and otherwise compares
 * without early-exit, preventing timing analysis of the secret over many
 * requests. Use for shared-secret header checks on machine-to-machine webhooks.
 */
export function timingSafeEqualSecret(received: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
