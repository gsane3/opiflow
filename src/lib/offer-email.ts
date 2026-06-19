import type { Offer } from './types';
import { fmtEur } from './offer-calculations';

function formatDateGR(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function buildEmailSubject(offer: Offer, businessName?: string): string {
  return `Προσφορά ${offer.offerNumber}${businessName ? ` από ${businessName}` : ''}`;
}

export function buildEmailBody(offer: Offer, customerName?: string, businessName?: string): string {
  const surname = customerName ? customerName.split(' ').slice(-1)[0] : null;
  const greeting = surname ? `Αγαπητέ/ή κύριε/κυρία ${surname},` : 'Αγαπητέ/ή κύριε/κυρία,';
  const itemLines = offer.items
    .map((item) => `- ${item.description}: ${fmtEur(item.quantity * item.unitPrice)}`)
    .join('\n');
  const from = businessName ? `\nΜε εκτίμηση,\n${businessName}` : '\nΜε εκτίμηση,';

  return `${greeting}

Σας αποστέλλουμε την προσφορά μας ${offer.offerNumber} με τα παρακάτω στοιχεία:

${itemLines}

Σύνολο (συμπ. ΦΠΑ ${offer.vatRate}%): ${fmtEur(offer.total)}${formatDateGR(offer.validUntil) ? `\nΙσχύει μέχρι: ${formatDateGR(offer.validUntil)}` : ''}

Παραμένουμε στη διάθεσή σας για οποιαδήποτε πληροφορία ή διευκρίνιση.
${from}`;
}
