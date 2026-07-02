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

Για create_invoice (έκδοση τιμολογίου/απόδειξης σε πελάτη):
{
  "intent": "create_invoice",
  "summary": "Έκδοση τιμολογίου 124€ στον Καραγιάννη.",
  "params": {
    "customerName": "Καραγιάννης",
    "invoiceAmount": 124,
    "invoiceDescription": "Παροχή υπηρεσιών",
    "invoiceVatRate": 24
  }
}

Για create_offer (ΞΕΧΩΡΙΣΤΗ γραμμή για κάθε είδος· τιμή 0 αν δεν ειπώθηκε):
{
  "intent": "create_offer",
  "summary": "Προετοιμασία προσφοράς με 3 είδη για τον πελάτη.",
  "params": {
    "customerName": "Καραγιάννης",
    "projectTitle": "",
    "offerItems": [
      { "description": "Baron 120x60", "quantity": 1, "unitPrice": 150 },
      { "description": "Baron 150x80", "quantity": 1, "unitPrice": 0 },
      { "description": "Baron 300x60", "quantity": 1, "unitPrice": 0 }
    ],
    "offerNotes": "",
    "offerTerms": ""
  }
}

Κανόνες:
- Χρησιμοποίησε ΜΟΝΟ αυτά τα intents: query_appointments, create_task, create_project, create_appointment, create_offer, create_invoice, cancel_appointment, unknown.
- create_invoice: ο χρήστης θέλει να ΕΚΔΩΣΕΙ τιμολόγιο ή απόδειξη σε πελάτη (π.χ. «τύπωσε/έκδωσε/κόψε τιμολόγιο 124 ευρώ στον Καραγιάννη»). Εξήγαγε customerName + invoiceAmount (το ΣΥΝΟΛΙΚΟ ποσό με ΦΠΑ που είπε ο χρήστης) + invoiceDescription (σύντομη, π.χ. «Παροχή υπηρεσιών» αν δεν ειπώθηκε) + invoiceVatRate (24 αν δεν ειπώθηκε). ΠΟΤΕ μην επινοείς ποσό — αν δεν ειπώθηκε ποσό, βάλε intent: "unknown". Η εφαρμογή θα δείξει έλεγχο πριν την έκδοση· μην ισχυριστείς ότι εκδόθηκε.
- query_appointments: ο χρήστης ρωτάει ποια ραντεβού έχει (σήμερα, αύριο, εβδομάδα, κλπ.).
- create_task: ο χρήστης θέλει να δημιουργήσει εσωτερικό task (κλήση, follow-up, υπενθύμιση, κλπ.).
- create_project: ο χρήστης θέλει να ξεκινήσει ΝΕΟ έργο για πελάτη (π.χ. «ξεκίνα έργο», «άνοιξε έργο», «νέο έργο για τον …»). Εξήγαγε customerName και projectTitle.
- create_appointment: ο χρήστης θέλει να κλείσει ραντεβού ή επίσκεψη με πελάτη.
- create_offer: ο χρήστης θέλει να ετοιμαστεί προσφορά με τιμές και υπηρεσίες. Εξήγαγε μόνο τις παραμέτρους· η εφαρμογή θα δείξει έλεγχο και θα ρωτήσει όνομα έργου πριν σταλεί. Μην ισχυριστείς ότι η προσφορά στάλθηκε.
- create_offer πολλαπλές γραμμές: φτιάξε ΞΕΧΩΡΙΣΤΗ γραμμή στο offerItems για ΚΑΘΕ είδος που λέει ο χρήστης (π.χ. «ένα baron 120x60, ένα baron 150x80, ένα baron 300x60» → 3 γραμμές, ΟΧΙ μία). Κράτα την περιγραφή όπως την είπε.
- create_offer τιμές: αν ο χρήστης ΔΕΝ είπε τιμή για ένα είδος, βάλε unitPrice: 0 (η εφαρμογή θα την πάρει από τον κατάλογο ή θα τη ζητήσει). Αν είπε τιμή, χρησιμοποίησέ την. ΠΟΤΕ μην επινοείς τιμή.
- cancel_appointment: ο χρήστης θέλει να ακυρώσει ένα υπάρχον ανοιχτό ραντεβού. Εξήγαγε μόνο παραμέτρους αναζήτησης (customerName, dueDate, dueTime, appointmentType). Η εφαρμογή θα ζητήσει επιβεβαίωση πριν ακυρωθεί. Μην ισχυριστείς ότι το ραντεβού ακυρώθηκε.
- unknown: οποιαδήποτε άλλη εντολή.
- projectTitle: ΣΥΝΤΟΜΟ όνομα για το έργο (work folder) όπου θα μπει η ενέργεια. Βγάλ' το από τη δουλειά που περιγράφεται (π.χ. «Επισκευή θέρμανσης», «Ανακαίνιση μπάνιου»). ΜΗΝ συμπεριλάβεις το όνομα του πελάτη στο projectTitle — μόνο τη δουλειά. Αν δεν προκύπτει, άφησέ το κενό — η εφαρμογή θα προτείνει προεπιλογή. Χρειάζεται για create_project, create_appointment, create_offer.
- Αν ο χρήστης ζητά διαγραφή, αποστολή email, αποστολή SMS ή οτιδήποτε άλλο εκτός των παραπάνω, επέστρεψε intent: "unknown" με σύντομο summary.
- Για create_task και create_appointment: εξήγαγε μόνο προσχέδιο παραμέτρων για έλεγχο χρήστη.
- dateRange χρειάζεται μόνο για query_appointments.
- appointmentType χρειάζεται μόνο για create_appointment.
- offerItems χρειάζεται μόνο για create_offer.
- Όλα τα κείμενα στα Ελληνικά.
- Μην επινοείς στοιχεία που δεν αναφέρονται στην εντολή.`;
}
