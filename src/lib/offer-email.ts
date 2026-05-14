import type { Offer } from './types';
import { fmtEur } from './offer-calculations';

function formatDateGR(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function buildEmailSubject(offer: Offer, businessName?: string): string {
  return `Προσφορά ${offer.offerNumber}${businessName ? ` από ${businessName}` : ''}`;
}

export function buildEmailBody(offer: Offer, customerName?: string, businessName?: string): string {
  const surname = customerName ? customerName.split(' ').slice(-1)[0] : null;
  const greeting = surname ? `Καλησπέρα κύριε/κυρία ${surname},` : 'Καλησπέρα,';
  const itemLines = offer.items
    .map((item) => `- ${item.description}: ${fmtEur(item.quantity * item.unitPrice)}`)
    .join('\n');
  const from = businessName ? `\nΜε εκτίμηση,\n${businessName}` : '\nΜε εκτίμηση,';

  return `${greeting}

Σας αποστέλλω την προσφορά μας ${offer.offerNumber} όπως συζητήσαμε.

Η προσφορά περιλαμβάνει:
${itemLines}

Σύνολο (συμπ. ΦΠΑ ${offer.vatRate}%): ${fmtEur(offer.total)}
Ισχύει μέχρι: ${formatDateGR(offer.validUntil)}

Είμαι στη διάθεσή σας για οποιαδήποτε διευκρίνιση.
${from}`;
}
