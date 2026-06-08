// Communication action abstraction.
// Native links now; future cloud version can switch to provider_stub or real provider mode.

export type CommunicationChannel = 'call' | 'sms' | 'viber' | 'whatsapp';
export type CommunicationMode = 'native_link' | 'provider_stub';

export function getCommunicationMode(): CommunicationMode {
  return 'native_link';
}

export function buildCallHref(phone: string): string {
  return `tel:${phone}`;
}

export function buildSmsHref(phone: string, message?: string): string {
  if (message) return `sms:${phone}?body=${encodeURIComponent(message)}`;
  return `sms:${phone}`;
}

// Normalize a phone to international digits for WhatsApp (no '+', spaces, dashes,
// parens or dots). Greek default: strip '+', strip leading '00'/'0030', and prepend
// '30' for a 10-digit local Greek number (starts with 6 or 2). Numbers that already
// carry a country code (e.g. '30...') are kept as-is.
function normalizeWhatsAppNumber(phone: string): string {
  let clean = phone.replace(/[\s\-()\.]/g, '').replace(/^\+/, '');
  if (clean.startsWith('0030')) clean = clean.slice(2);
  else if (clean.startsWith('00')) clean = clean.slice(2);
  clean = clean.replace(/\D/g, '');
  if (/^30/.test(clean)) return clean;
  if (/^[62]\d{9}$/.test(clean)) return `30${clean}`;
  return clean;
}

export function buildWhatsAppHref(phone: string, message?: string): string {
  const num = normalizeWhatsAppNumber(phone);
  const base = `https://wa.me/${num}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

export function buildEmailHref(email: string, subject?: string, body?: string): string {
  const params: string[] = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return params.length ? `mailto:${email}?${params.join('&')}` : `mailto:${email}`;
}

export function buildProviderActionLabel(channel: CommunicationChannel): string {
  const labels: Record<CommunicationChannel, string> = {
    call: 'Κλήση',
    sms: 'SMS',
    viber: 'Viber',
    whatsapp: 'WhatsApp',
  };
  return labels[channel];
}
