import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Πολιτική Απορρήτου',
  description: 'Πολιτική Απορρήτου και προστασία δεδομένων (GDPR) της υπηρεσίας Opiflow.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-[100dvh] bg-white dark:bg-[#0e1722]">
      <div className="mx-auto max-w-2xl px-5 py-12">
        <Link href="/" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">← Opiflow</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Πολιτική Απορρήτου</h1>
        <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">Τελευταία ενημέρωση: Ιούνιος 2026 · Συμμόρφωση με GDPR (ΕΕ 2016/679)</p>

        <div className="mt-8 space-y-7 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-200">
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Υπεύθυνος επεξεργασίας</h2>
            <p>Υπεύθυνος επεξεργασίας για τα δεδομένα του λογαριασμού σας είναι η <b>Αντιπλημμυρικά Ελλάδος ΙΚΕ</b> (ΓΕΜΗ 194339601000, ΑΦΜ 803311450), Μάρκου Μπότσαρη 84 &amp; Κύπρου, 122 41 Αιγάλεω, Αθήνα. Επικοινωνία για θέματα προσωπικών δεδομένων: <a href="mailto:info@opiflow.ai" className="font-medium text-indigo-600 hover:text-indigo-700">info@opiflow.ai</a>.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Τι δεδομένα συλλέγουμε</h2>
            <ul className="ml-4 list-disc space-y-1">
              <li><b>Στοιχεία λογαριασμού:</b> email, όνομα, στοιχεία επιχείρησης.</li>
              <li><b>Δεδομένα πελατών σας:</b> ονόματα, τηλέφωνα, email, διευθύνσεις, σημειώσεις, αρχεία — τα οποία εισάγετε εσείς ή προκύπτουν από κλήσεις.</li>
              <li><b>Δεδομένα κλήσεων & επικοινωνιών:</b> μεταδεδομένα κλήσεων, περιλήψεις. Οι ηχογραφήσεις δεν αποθηκεύονται μόνιμα.</li>
              <li><b>Τεχνικά δεδομένα:</b> διεύθυνση IP, τύπος συσκευής, για ασφάλεια και λειτουργία.</li>
            </ul>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Σκοπός & νομική βάση</h2>
            <p>Επεξεργαζόμαστε δεδομένα για την παροχή της υπηρεσίας (εκτέλεση σύμβασης), την ασφάλεια (έννομο συμφέρον) και τη συμμόρφωση με τον νόμο. Για τα δεδομένα των πελατών σας, ενεργούμε ως <b>εκτελών την επεξεργασία</b> και εσείς ως υπεύθυνος επεξεργασίας.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Τρίτοι πάροχοι (υπο‑εκτελούντες)</h2>
            <p>Χρησιμοποιούμε αξιόπιστους παρόχους αποκλειστικά για τη λειτουργία: Supabase (βάση & αποθήκευση), Anthropic, OpenAI & Deepgram (τεχνητή νοημοσύνη & μεταγραφή φωνής), Apifon (Viber/SMS), Twilio και τον πάροχο τηλεφωνικών γραμμών (τηλεφωνία), Vercel (φιλοξενία) και Sentry (παρακολούθηση σφαλμάτων). Δεν πουλάμε δεδομένα.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Διατήρηση</h2>
            <p>Διατηρούμε τα δεδομένα όσο είναι ενεργός ο λογαριασμός σας και όσο απαιτείται από τον νόμο. Μπορείτε να ζητήσετε διαγραφή οποτεδήποτε.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Τα δικαιώματά σας (GDPR)</h2>
            <p>Έχετε δικαίωμα πρόσβασης, διόρθωσης, διαγραφής, φορητότητας (εξαγωγή), περιορισμού και εναντίωσης. Η εξαγωγή πελατών είναι διαθέσιμη μέσα στην εφαρμογή (Ρυθμίσεις → Δεδομένα). Για διαγραφή λογαριασμού & δεδομένων επικοινωνήστε στο <a href="mailto:info@opiflow.ai" className="font-medium text-indigo-600 hover:text-indigo-700">info@opiflow.ai</a>. Έχετε επίσης δικαίωμα καταγγελίας στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (dpa.gr).</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Ασφάλεια</h2>
            <p>Εφαρμόζουμε κρυπτογράφηση κατά τη μεταφορά και στην αποθήκευση, απομόνωση δεδομένων ανά επιχείρηση και έλεγχο πρόσβασης. Καμία μέθοδος δεν είναι 100% ασφαλής, αλλά λαμβάνουμε εύλογα μέτρα.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
