// Simple rule-based parser for customer SMS detail replies.
// No AI or external service — label matching + positional fallback.

export interface ParsedSmsData {
  firstName: string;
  lastName: string;
  address: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Match a labeled line and return the value after the label.
// Accepts "Label: value", "Label value", and Greek accent variants.
function extractLabelValue(line: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + escaped + '\\s*:?\\s*(.+)', 'iu');
    const m = line.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export function parseSmsReply(text: string): ParsedSmsData {
  const result: ParsedSmsData = { firstName: '', lastName: '', address: '', email: '' };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let anyLabelMatch = false;

  for (const line of lines) {
    if (!result.firstName) {
      const v = extractLabelValue(line, 'Όνομα', 'Ονομα', 'Name', 'First Name', 'Firstname');
      if (v) { result.firstName = v; anyLabelMatch = true; continue; }
    }
    if (!result.lastName) {
      const v = extractLabelValue(line, 'Επώνυμο', 'Επωνυμο', 'Surname', 'Last Name', 'Lastname');
      if (v) { result.lastName = v; anyLabelMatch = true; continue; }
    }
    if (!result.address) {
      const v = extractLabelValue(line, 'Διεύθυνση', 'Διευθυνση', 'Address');
      if (v) { result.address = v; anyLabelMatch = true; continue; }
    }
    if (!result.email) {
      const v = extractLabelValue(line, 'Email', 'E-mail', 'E mail');
      if (v) { result.email = v; anyLabelMatch = true; continue; }
      // Bare email on its own line
      if (EMAIL_RE.test(line)) { result.email = line; anyLabelMatch = true; continue; }
    }
  }

  // Positional fallback: used when no labels were detected.
  if (!anyLabelMatch) {
    if (lines.length >= 4) {
      result.firstName = lines[0];
      result.lastName = lines[1];
      result.address = lines[2];
      result.email = lines[3];
    } else if (lines.length === 3) {
      result.firstName = lines[0];
      result.lastName = lines[1];
      if (EMAIL_RE.test(lines[2])) {
        result.email = lines[2];
      } else {
        result.address = lines[2];
      }
    } else if (lines.length === 2) {
      result.firstName = lines[0];
      result.lastName = lines[1];
    } else if (lines.length === 1) {
      // Single line — treat as first name only
      result.firstName = lines[0];
    }
  }

  return result;
}

export function formatParsedData(data: ParsedSmsData): string {
  const parts: string[] = [];
  if (data.firstName) parts.push(`Όνομα: ${data.firstName}`);
  if (data.lastName) parts.push(`Επώνυμο: ${data.lastName}`);
  if (data.address) parts.push(`Διεύθυνση: ${data.address}`);
  if (data.email) parts.push(`Email: ${data.email}`);
  return parts.join('\n');
}
