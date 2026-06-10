// Display formatting — DD-MM-YYYY dates (project convention) + euro amounts.

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Σήμερα 14:30" / "12-06 09:00" / "12-06-2025" for older years. */
export function formatWhen(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Σήμερα ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const dm = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
  return sameYear ? `${dm} ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${dm}-${d.getFullYear()}`;
}

/** YYYY-MM-DD for "today" in local time (matches the API's dueDate convention). */
export function todayYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** DD-MM-YYYY (user input) → YYYY-MM-DD (API), or null when invalid. */
export function dmyToYmd(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = Number(dd);
  const mo = Number(mm);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${yyyy}-${pad(mo)}-${pad(d)}`;
}

export function formatEuro(value?: number | null): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return `${value.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** First meaningful line of an AI brief/summary (skip marker lines like uniqueid=). */
export function briefExcerpt(summary?: string | null, max = 110): string {
  if (!summary) return '';
  const line = summary
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^(uniqueid=|twilio_sid=|---)/.test(l));
  if (!line) return '';
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}
