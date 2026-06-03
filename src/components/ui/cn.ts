/**
 * Tiny className combiner — dependency-free (no clsx / tailwind-merge).
 *
 * Accepts strings, falsy values, arrays, and `{ 'class': boolean }` maps,
 * flattens them, drops falsy entries, and joins with a single space.
 *
 *   cn('a', condition && 'b', { c: isActive }, ['d', null])
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];

  for (const input of inputs) {
    if (!input) continue;

    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const nested = cn(...input);
      if (nested) out.push(nested);
    } else if (typeof input === 'object') {
      for (const key in input) {
        if (input[key]) out.push(key);
      }
    }
  }

  return out.join(' ');
}
