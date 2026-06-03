import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Όροι Χρήσης',
  description: 'Όροι Χρήσης της υπηρεσίας deskop.',
};

export default function TermsPage() {
  return (
    <main className="min-h-[100dvh] bg-white">
      <div className="mx-auto max-w-2xl px-5 py-12">
        <Link href="/" className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">← deskop</Link>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-zinc-900">Όροι Χρήσης</h1>
        <p className="mt-2 text-sm text-zinc-400">Τελευταία ενημέρωση: Ιούνιος 2026</p>

        <div className="mt-8 space-y-7 text-[15px] leading-relaxed text-zinc-700">
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">1. Η υπηρεσία</h2>
            <p>Το deskop («η υπηρεσία») παρέχει επαγγελματικό τηλέφωνο, διαχείριση πελατών (CRM), δημιουργία προσφορών, ραντεβού και αυτοματισμούς με τεχνητή νοημοσύνη για επαγγελματίες. Χρησιμοποιώντας την υπηρεσία αποδέχεστε τους παρόντες όρους.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">2. Λογαριασμός</h2>
            <p>Είστε υπεύθυνοι για την ασφάλεια του λογαριασμού σας και για κάθε δραστηριότητα που γίνεται μέσω αυτού. Πρέπει να παρέχετε ακριβή στοιχεία και να είστε άνω των 18 ετών ή να εκπροσωπείτε νόμιμα μια επιχείρηση.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">3. Αποδεκτή χρήση</h2>
            <p>Δεν επιτρέπεται η χρήση της υπηρεσίας για ανεπιθύμητη επικοινωνία (spam), παράνομες ενέργειες, παραβίαση δικαιωμάτων τρίτων ή αποστολή μηνυμάτων χωρίς τη νόμιμη βάση επικοινωνίας με τον παραλήπτη. Είστε υπεύθυνοι για τη συμμόρφωση με τους κανόνες των παρόχων (π.χ. Viber, τηλεφωνία) και τη νομοθεσία περί επικοινωνιών.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">4. Δεδομένα πελατών σας</h2>
            <p>Τα δεδομένα των δικών σας πελατών παραμένουν δικά σας. Το deskop τα επεξεργάζεται ως «εκτελών την επεξεργασία» για λογαριασμό σας, αποκλειστικά για την παροχή της υπηρεσίας. Δείτε την <Link href="/privacy" className="font-medium text-indigo-600 hover:text-indigo-700">Πολιτική Απορρήτου</Link>.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">5. Συνδρομή & χρεώσεις</h2>
            <p>Η πρόσβαση μπορεί να απαιτεί συνδρομή. Οι χρεώσεις, η ανανέωση και η ακύρωση περιγράφονται κατά την εγγραφή. Η χρήση τηλεφωνίας και μηνυμάτων ενδέχεται να χρεώνεται βάσει κατανάλωσης.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">6. AI</h2>
            <p>Τα αποτελέσματα της τεχνητής νοημοσύνης (περιλήψεις, προτάσεις) είναι βοηθητικά και ενδέχεται να περιέχουν σφάλματα. Ελέγχετε πάντα πριν στείλετε οτιδήποτε σε πελάτη.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">7. Περιορισμός ευθύνης</h2>
            <p>Η υπηρεσία παρέχεται «ως έχει». Στο μέγιστο βαθμό που επιτρέπει ο νόμος, το deskop δεν ευθύνεται για έμμεσες ή αποθετικές ζημίες. Καταβάλλουμε εύλογες προσπάθειες για διαθεσιμότητα αλλά δεν εγγυόμαστε αδιάλειπτη λειτουργία.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">8. Τερματισμός</h2>
            <p>Μπορείτε να διαγράψετε τον λογαριασμό σας οποτεδήποτε. Μπορούμε να αναστείλουμε λογαριασμούς που παραβιάζουν τους όρους.</p>
          </section>
          <section>
            <h2 className="mb-1.5 text-lg font-semibold text-zinc-900">9. Επικοινωνία</h2>
            <p>Για ερωτήσεις: <a href="mailto:support@deskop.ai" className="font-medium text-indigo-600 hover:text-indigo-700">support@deskop.ai</a>.</p>
          </section>
          <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-xs text-zinc-400">
            Το παρόν κείμενο είναι πρότυπο και πρέπει να ελεγχθεί από νομικό σύμβουλο πριν τη δημόσια κυκλοφορία.
          </p>
        </div>
      </div>
    </main>
  );
}
