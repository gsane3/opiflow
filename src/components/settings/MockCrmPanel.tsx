'use client';

const IMPORT_SOURCES = [
  {
    label: 'Excel / CSV',
    desc: 'Εισαγωγή επαφών από υπολογιστικό φύλλο',
    icon: '📊',
  },
  {
    label: 'Google Contacts',
    desc: 'Συγχρονισμός επαφών από Google',
    icon: '📇',
  },
  {
    label: 'Facebook Leads',
    desc: 'Αυτόματη εισαγωγή από διαφημίσεις Meta',
    icon: '📣',
  },
];

export default function MockCrmPanel() {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-base font-semibold text-zinc-900">Εισαγωγή επαφών (CRM)</h2>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          Demo
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {IMPORT_SOURCES.map((src) => (
          <div
            key={src.label}
            className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5 text-center"
          >
            <span className="text-2xl">{src.icon}</span>
            <p className="text-sm font-medium text-zinc-700">{src.label}</p>
            <p className="text-xs text-zinc-400">{src.desc}</p>
            <span className="mt-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Σύντομα
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-zinc-400">
        Καμία εισαγωγή δεν είναι ενεργοποιημένη. Τα δεδομένα παραμένουν τοπικά.
      </p>
    </section>
  );
}
