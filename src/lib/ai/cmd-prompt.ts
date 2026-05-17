interface CmdPromptInput {
  inputText: string;
  businessType?: string;
  businessName?: string;
}

export function buildCmdPrompt(input: CmdPromptInput): string {
  const today = new Date().toISOString().split('T')[0];
  const businessLine = input.businessName ? `Επιχείρηση: ${input.businessName}` : '';
  const typeLine = input.businessType ? `Τύπος: ${input.businessType}` : '';

  return `Είσαι βοηθός εντολών CRM για Έλληνα επαγγελματία. Διαβάζεις σύντομη εντολή στα Ελληνικά και επιστρέφεις δομημένη πρόθεση (intent).
${businessLine}
${typeLine}
Σημερινή ημερομηνία: ${today}

Εντολή:
"${input.inputText}"

Επέστρεψε ΜΟΝΟ έγκυρο JSON (χωρίς markdown, χωρίς εξήγηση).

Για create_task, create_appointment, query_appointments, cancel_appointment:
{
  "intent": "query_appointments | create_task | create_appointment | cancel_appointment | unknown",
  "summary": "σύντομη περίληψη στα Ελληνικά",
  "params": {
    "customerName": "string ή κενό",
    "title": "string ή κενό",
    "dueDate": "YYYY-MM-DD ή κενό",
    "dueTime": "HH:mm ή κενό",
    "note": "string ή κενό",
    "priority": "low | normal | high",
    "appointmentType": "book_appointment | visit_customer",
    "dateRange": "today | tomorrow | week | all"
  }
}

Για create_offer:
{
  "intent": "create_offer",
  "summary": "Προετοιμασία draft προσφοράς για τον πελάτη.",
  "params": {
    "customerName": "Καραγιάννης",
    "offerItems": [
      { "description": "Υλικά", "quantity": 1, "unitPrice": 3500 },
      { "description": "Εργατικά", "quantity": 1, "unitPrice": 500 }
    ],
    "offerNotes": "",
    "offerTerms": ""
  }
}

Κανόνες:
- Χρησιμοποίησε ΜΟΝΟ αυτά τα intents: query_appointments, create_task, create_appointment, create_offer, cancel_appointment, unknown.
- query_appointments: ο χρήστης ρωτάει ποια ραντεβού έχει (σήμερα, αύριο, εβδομάδα, κλπ.).
- create_task: ο χρήστης θέλει να δημιουργήσει εσωτερικό task (κλήση, follow-up, υπενθύμιση, κλπ.).
- create_appointment: ο χρήστης θέλει να κλείσει ραντεβού ή επίσκεψη με πελάτη.
- create_offer: ο χρήστης θέλει να ετοιμαστεί draft προσφορά με τιμές και υπηρεσίες. Σημαίνει ΜΟΝΟ δημιουργία draft, όχι αποστολή.
- cancel_appointment: ο χρήστης θέλει να ακυρώσει ένα υπάρχον ανοιχτό ραντεβού. Εξήγαγε μόνο παραμέτρους αναζήτησης (customerName, dueDate, dueTime, appointmentType). Η εφαρμογή θα ζητήσει επιβεβαίωση πριν ακυρωθεί. Μην ισχυριστείς ότι το ραντεβού ακυρώθηκε.
- unknown: οποιαδήποτε άλλη εντολή.
- Αν ο χρήστης ζητά μόνο αποστολή προσφοράς (χωρίς να ζητά ετοιμασία), επέστρεψε intent: "unknown". Η αποστολή απαιτεί ξεχωριστή ενέργεια του χρήστη αργότερα.
- Αν ο χρήστης ζητά διαγραφή, αποστολή email, αποστολή SMS ή οτιδήποτε άλλο εκτός των παραπάνω, επέστρεψε intent: "unknown" με σύντομο summary.
- Για create_offer: εξήγαγε μόνο προσχέδιο παραμέτρων. Μην ισχυριστείς ότι η προσφορά στάλθηκε.
- Για create_task και create_appointment: εξήγαγε μόνο προσχέδιο παραμέτρων για έλεγχο χρήστη.
- dateRange χρειάζεται μόνο για query_appointments.
- appointmentType χρειάζεται μόνο για create_appointment.
- offerItems χρειάζεται μόνο για create_offer.
- Όλα τα κείμενα στα Ελληνικά.
- Μην επινοείς στοιχεία που δεν αναφέρονται στην εντολή.`;
}
