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

Για create_task, create_appointment, query_appointments, cancel_appointment, create_project:
{
  "intent": "query_appointments | create_task | create_project | create_appointment | cancel_appointment | unknown",
  "summary": "σύντομη περίληψη στα Ελληνικά",
  "params": {
    "customerName": "string ή κενό",
    "title": "string ή κενό",
    "projectTitle": "string ή κενό",
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
  "summary": "Προετοιμασία προσφοράς για τον πελάτη.",
  "params": {
    "customerName": "Καραγιάννης",
    "projectTitle": "Ανακαίνιση μπάνιου",
    "offerItems": [
      { "description": "Υλικά", "quantity": 1, "unitPrice": 3500 },
      { "description": "Εργατικά", "quantity": 1, "unitPrice": 500 }
    ],
    "offerNotes": "",
    "offerTerms": ""
  }
}

Κανόνες:
- Χρησιμοποίησε ΜΟΝΟ αυτά τα intents: query_appointments, create_task, create_project, create_appointment, create_offer, cancel_appointment, unknown.
- query_appointments: ο χρήστης ρωτάει ποια ραντεβού έχει (σήμερα, αύριο, εβδομάδα, κλπ.).
- create_task: ο χρήστης θέλει να δημιουργήσει εσωτερικό task (κλήση, follow-up, υπενθύμιση, κλπ.).
- create_project: ο χρήστης θέλει να ξεκινήσει ΝΕΟ έργο για πελάτη (π.χ. «ξεκίνα έργο», «άνοιξε έργο», «νέο έργο για τον …»). Εξήγαγε customerName και projectTitle.
- create_appointment: ο χρήστης θέλει να κλείσει ραντεβού ή επίσκεψη με πελάτη.
- create_offer: ο χρήστης θέλει να ετοιμαστεί προσφορά με τιμές και υπηρεσίες. Εξήγαγε μόνο τις παραμέτρους· η εφαρμογή θα δείξει έλεγχο και θα ρωτήσει όνομα έργου πριν σταλεί. Μην ισχυριστείς ότι η προσφορά στάλθηκε.
- cancel_appointment: ο χρήστης θέλει να ακυρώσει ένα υπάρχον ανοιχτό ραντεβού. Εξήγαγε μόνο παραμέτρους αναζήτησης (customerName, dueDate, dueTime, appointmentType). Η εφαρμογή θα ζητήσει επιβεβαίωση πριν ακυρωθεί. Μην ισχυριστείς ότι το ραντεβού ακυρώθηκε.
- unknown: οποιαδήποτε άλλη εντολή.
- projectTitle: ΣΥΝΤΟΜΟ όνομα για το έργο (work folder) όπου θα μπει η ενέργεια. Βγάλ' το από τη δουλειά που περιγράφεται (π.χ. «Επισκευή θέρμανσης», «Ανακαίνιση μπάνιου»). Αν δεν προκύπτει, άφησέ το κενό — η εφαρμογή θα προτείνει προεπιλογή. Χρειάζεται για create_project, create_appointment, create_offer.
- Αν ο χρήστης ζητά διαγραφή, αποστολή email, αποστολή SMS ή οτιδήποτε άλλο εκτός των παραπάνω, επέστρεψε intent: "unknown" με σύντομο summary.
- Για create_task και create_appointment: εξήγαγε μόνο προσχέδιο παραμέτρων για έλεγχο χρήστη.
- dateRange χρειάζεται μόνο για query_appointments.
- appointmentType χρειάζεται μόνο για create_appointment.
- offerItems χρειάζεται μόνο για create_offer.
- Όλα τα κείμενα στα Ελληνικά.
- Μην επινοείς στοιχεία που δεν αναφέρονται στην εντολή.`;
}
