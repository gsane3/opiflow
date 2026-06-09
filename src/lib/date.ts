// Canonical date formatting for the app — DD-MM-YYYY (Greek convention, hyphen
// separators). Single source of truth so every surface renders dates the same way.
// Pure functions: safe on both client and server.

/** Accepts a date-only string (YYYY-MM-DD) or a full ISO timestamp. */
export function formatDateGr(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${d.getFullYear()}`;
  } catch {
    return '';
  }
}

/** DD-MM-YYYY HH:MM for timestamps. */
export function formatDateTimeGr(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${formatDateGr(iso)} ${hh}:${min}`;
  } catch {
    return '';
  }
}
