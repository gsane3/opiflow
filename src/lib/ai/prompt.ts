import type { BusinessType } from '../types';

interface PromptContext {
  inputText: string;
  businessType?: BusinessType;
  businessName?: string;
  defaultVatRate?: number;
}

const BUSINESS_LABELS: Partial<Record<BusinessType, string>> = {
  technical_services: 'Τεχνικές υπηρεσίες (HVAC, υδραυλικός, ηλεκτρολόγος, μηχανικός)',
  sales_services: 'Πωλήσεις / υπηρεσίες (ασφαλιστής, σύμβουλος, μεσίτης)',
  projects_construction: 'Κατασκευές / έργα (ανακαινίσεις, εργολάβος)',
  other: 'Άλλο επάγγελμα',
};

export function buildPrompt(ctx: PromptContext): string {
  const businessLabel = ctx.businessType
    ? (BUSINESS_LABELS[ctx.businessType] ?? 'Επαγγελματίας')
    : 'Επαγγελματίας';

  const businessLine = ctx.businessName ? `Επιχείρηση: ${ctx.businessName}` : '';
  const vatLine = `ΦΠΑ: ${ctx.defaultVatRate ?? 24}%`;

  return `Είσαι βοηθός CRM για Έλληνα επαγγελματία. Σου δίνεται σύντομη περιγραφή πελάτη ή συνομιλίας και εξάγεις δομημένα δεδομένα.

Επάγγελμα: ${businessLabel}
${businessLine}
${vatLine}

Είσοδος:
"${ctx.inputText}"

Επέστρεψε ΜΟΝΟ έγκυρο JSON (χωρίς markdown, χωρίς εξήγηση):
{
  "customer": {
    "name": "string (κενό αν άγνωστο)",
    "phone": "string",
    "email": "string",
    "source": "inbound_call|missed_call|referral|facebook_ads|google_ads|website_form|manual_entry|other",
    "opportunityValue": number (0 αν άγνωστο),
    "preferredContactMethod": "viber|email|phone"
  },
  "summary": "string σύντομη περίληψη στα Ελληνικά",
  "customerNeeds": "string ανάγκες πελάτη στα Ελληνικά",
  "tasks": [
    {
      "title": "string στα Ελληνικά",
      "type": "call_back|send_offer|follow_up_offer|ask_for_photos_documents|book_appointment|visit_customer|wait_for_reply|other",
      "dueDate": "YYYY-MM-DD (αύριο αν άγνωστο)",
      "dueTime": "HH:mm ή κενό",
      "priority": "low|normal|high",
      "note": "string"
    }
  ],
  "offer": {
    "shouldCreate": boolean,
    "items": [{ "description": "string", "quantity": number, "unitPrice": number }],
    "notes": "string",
    "terms": "string"
  },
  "statusUpdate": "new_lead|contacted|follow_up_needed|offer_drafted|offer_sent|won|lost",
  "nextBestAction": "string στα Ελληνικά",
  "warnings": ["string"]
}

Κανόνες:
- Όλο το κείμενο στα Ελληνικά.
- Μην επινοείς ονόματα ή ποσά που δεν αναφέρονται.
- Πρότεινε task μόνο αν έχει νόημα.
- Πρότεινε προσφορά μόνο αν αναφέρονται τιμές ή υπηρεσίες.
- Προειδοποίησε αν κάτι χρειάζεται επιβεβαίωση.`;
}
