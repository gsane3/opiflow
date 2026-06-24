import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Όροι Χρήσης',
  description: 'Όροι Χρήσης της υπηρεσίας Opiflow.',
};

export default function TermsPage() {
  return (
    <main className="min-h-[100dvh] bg-white dark:bg-[#0e1722]">
      <div className="mx-auto max-w-2xl px-5 py-12">
        <Link href="/" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">← Opiflow</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Όροι Χρήσης</h1>
        <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-500">Τελευταία ενημέρωση: Ιούνιος 2026</p>

        <div className="mt-5 rounded-2xl border border-zinc-200 dark:border-[#26374a] bg-zinc-50 dark:bg-[#16222e] px-4 py-3 text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          <b className="text-zinc-900 dark:text-zinc-100">Πάροχος υπηρεσίας:</b> Αντιπλημμυρικά Ελλάδος ΙΚΕ · ΓΕΜΗ 194339601000 · ΑΦΜ 803311450<br />
          Έδρα: Μάρκου Μπότσαρη 84 &amp; Κύπρου, 122 41 Αιγάλεω, Αθήνα<br />
          Επικοινωνία: <a href="mailto:info@opiflow.ai" className="font-medium text-indigo-600 hover:text-indigo-700">info@opiflow.ai</a>
        </div>

        <div className="mt-8 space-y-7 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-200">
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">1. Η υπηρεσία</h2>
            <p>Το Opiflow («η υπηρεσία») παρέχει επαγγελματικό τηλέφωνο, διαχείριση πελατών (CRM), δημιουργία προσφορών, ραντεβού και αυτοματισμούς με τεχνητή νοημοσύνη για επαγγελματίες. Χρησιμοποιώντας την υπηρεσία αποδέχεστε τους παρόντες όρους.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">2. Λογαριασμός</h2>
            <p>Είστε υπεύθυνοι για την ασφάλεια του λογαριασμού σας και για κάθε δραστηριότητα που γίνεται μέσω αυτού. Πρέπει να παρέχετε ακριβή στοιχεία και να είστε άνω των 18 ετών ή να εκπροσωπείτε νόμιμα μια επιχείρηση.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">3. Αποδεκτή χρήση</h2>
            <p>Δεν επιτρέπεται η χρήση της υπηρεσίας για ανεπιθύμητη επικοινωνία (spam), παράνομες ενέργειες, παραβίαση δικαιωμάτων τρίτων ή αποστολή μηνυμάτων χωρίς τη νόμιμη βάση επικοινωνίας με τον παραλήπτη. Είστε υπεύθυνοι για τη συμμόρφωση με τους κανόνες των παρόχων (π.χ. Viber, τηλεφωνία) και τη νομοθεσία περί επικοινωνιών.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">4. Δεδομένα πελατών σας</h2>
            <p>Τα δεδομένα των δικών σας πελατών παραμένουν δικά σας. Το Opiflow τα επεξεργάζεται ως «εκτελών την επεξεργασία» για λογαριασμό σας, αποκλειστικά για την παροχή της υπηρεσίας. Δείτε την <Link href="/privacy" className="font-medium text-indigo-600 hover:text-indigo-700">Πολιτική Απορρήτου</Link>.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">5. Συνδρομή & χρεώσεις</h2>
            <p>Η πρόσβαση στην υπηρεσία παρέχεται με ενιαία μηνιαία συνδρομή ανά επιχείρηση:</p>
            <ul className="mt-2 ml-4 list-disc space-y-1">
              <li><b>Συνδρομή Opiflow:</b> 29,95 € + ΦΠΑ 24% τον μήνα (37,14 € με ΦΠΑ) — διαχείριση πελατών, προσφορές, ραντεβού, αιτήματα στοιχείων/φωτογραφιών, αυτοματισμοί, επαγγελματικό τηλέφωνο, κλήσεις και αυτόματη σύνοψη κλήσεων με AI.</li>
            </ul>
            <p className="mt-2">Οι τιμές αναγράφονται χωρίς ΦΠΑ· προστίθεται ΦΠΑ 24%. Η συνδρομή <b>ανανεώνεται αυτόματα κάθε μήνα</b> μέχρι να την ακυρώσετε. Μπορείτε να ακυρώσετε οποτεδήποτε από τις Ρυθμίσεις ή με email στο <a href="mailto:info@opiflow.ai" className="font-medium text-indigo-600 hover:text-indigo-700">info@opiflow.ai</a>· η ακύρωση ισχύει στο τέλος της τρέχουσας περιόδου χρέωσης. Έχετε δικαίωμα <b>υπαναχώρησης εντός 14 ημερών</b> από την έναρξη της συνδρομής. Ο τρόπος πληρωμής ορίζεται κατά την εγγραφή. Η χρήση τηλεφωνίας και μηνυμάτων ενδέχεται να χρεώνεται επιπλέον βάσει κατανάλωσης.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">6. AI</h2>
            <p>Τα αποτελέσματα της τεχνητής νοημοσύνης (περιλήψεις, προτάσεις) είναι βοηθητικά και ενδέχεται να περιέχουν σφάλματα. Ελέγχετε πάντα πριν στείλετε οτιδήποτε σε πελάτη.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">7. Περιορισμός ευθύνης</h2>
            <p>Η υπηρεσία παρέχεται «ως έχει». Στο μέγιστο βαθμό που επιτρέπει ο νόμος, το Opiflow δεν ευθύνεται για έμμεσες ή αποθετικές ζημίες. Καταβάλλουμε εύλογες προσπάθειες για διαθεσιμότητα αλλά δεν εγγυόμαστε αδιάλειπτη λειτουργία.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">8. Τερματισμός</h2>
            <p>Μπορείτε να διαγράψετε τον λογαριασμό σας οποτεδήποτε. Μπορούμε να αναστείλουμε λογαριασμούς που παραβιάζουν τους όρους.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">9. Επικοινωνία</h2>
            <p>Για ερωτήσεις: <a href="mailto:info@opiflow.ai" className="font-medium text-indigo-600 hover:text-indigo-700">info@opiflow.ai</a>.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">10. Εφαρμοστέο δίκαιο</h2>
            <p>Οι παρόντες όροι διέπονται από το ελληνικό δίκαιο. Για κάθε διαφορά αρμόδια είναι τα δικαστήρια των Αθηνών.</p>
          </section>
        </div>
      </div>
    </main>
  );
}
