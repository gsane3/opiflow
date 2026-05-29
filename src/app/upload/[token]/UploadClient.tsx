'use client';

interface Props {
  valid: boolean;
  reason: 'expired' | 'invalid' | null;
}

export default function UploadClient({ valid, reason }: Props) {
  if (!valid) {
    const isExpired = reason === 'expired';
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
          <div className="mb-4 text-center text-3xl">{isExpired ? '⏰' : '🔒'}</div>
          <h1 className="mb-2 text-center text-base font-semibold text-zinc-900">
            {isExpired
              ? 'Ο σύνδεσμος έχει ολοκληρωθεί ή έχει λήξει.'
              : 'Ο σύνδεσμος δεν είναι διαθέσιμος.'}
          </h1>
          <p className="text-center text-sm text-zinc-500">
            {isExpired
              ? 'Ο σύνδεσμος έχει ήδη χρησιμοποιηθεί ή δεν είναι πλέον ενεργός.'
              : 'Ο σύνδεσμος δεν αναγνωρίζεται ή έχει ανακληθεί. Επικοινωνήστε με την επιχείρεση για νέο σύνδεσμο.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <div className="mb-4 text-center text-3xl">📷</div>
        <h1 className="mb-3 text-center text-base font-semibold text-zinc-900">
          Ανέβασμα φωτογραφιών / βίντεο
        </h1>
        <p className="mb-3 text-center text-sm text-zinc-600">
          Ο σύνδεσμος είναι έγκυρος.
        </p>
        <p className="mb-3 text-center text-sm text-zinc-500">
          Στο επόμενο βήμα θα μπορείτε να ανεβάσετε φωτογραφίες ή βίντεο από τη συσκευή και τον χώρο.
        </p>
        <p className="text-center text-sm text-zinc-400">
          Αν χρειάζεται κάτι άμεσα, επικοινωνήστε με την επιχείρεση.
        </p>
      </div>
    </div>
  );
}
