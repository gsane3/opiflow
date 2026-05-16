'use client';

import Link from 'next/link';

const DEMO_STEPS = [
  {
    step: 1,
    title: 'Dashboard',
    href: '/dashboard',
    desc: 'Δες τις προτεραιότητες της ημέρας, εκκρεμή tasks και πρόσφατες επικοινωνίες.',
  },
  {
    step: 2,
    title: 'Demo κλήση',
    href: '/call/mock',
    desc: 'Ξεκίνα μια demo κλήση, δημιούργησε καρτέλα πελάτη από SMS και αποθήκευσε brief.',
  },
  {
    step: 3,
    title: 'AI Review',
    href: '/ai-review',
    desc: 'Ανέβασε υπαγόρευση ή κείμενο κλήσης. Έλεγξε και επεξεργάσου πριν αποθηκεύσεις.',
  },
  {
    step: 4,
    title: 'Καρτέλα πελάτη',
    href: '/customers',
    desc: 'Δες ιστορικό, tasks, προσφορές και brief κλήσεων για κάθε πελάτη.',
  },
  {
    step: 5,
    title: 'Προσφορά',
    href: '/offers',
    desc: 'Δημιούργησε, στείλε και παρακολούθησε προσφορές. Αποδοχή με demo link.',
  },
  {
    step: 6,
    title: 'Ρυθμίσεις / Backup',
    href: '/settings',
    desc: 'Κατέβασε backup, έλεγξε υγεία δεδομένων, εξήγαγε CSV πελατών.',
  },
];

export default function DemoPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <div className="mb-1 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
          Demo / Internal
        </div>
        <h1 className="text-xl font-bold text-zinc-900">Οδηγός Demo</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Suggested sequence for presenting the Yorgos AI MVP. All data is local/demo only.
        </p>
      </div>

      <ol className="space-y-3">
        {DEMO_STEPS.map((s) => (
          <li key={s.step}>
            <Link
              href={s.href}
              className="flex items-start gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 transition hover:ring-indigo-200"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white">
                {s.step}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-zinc-900">{s.title}</p>
                <p className="text-xs text-zinc-500">{s.desc}</p>
              </div>
              <svg className="h-4 w-4 shrink-0 text-zinc-400" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </Link>
          </li>
        ))}
      </ol>

      <div className="rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
        <p className="text-xs text-amber-700">
          Όλα τα δεδομένα είναι τοπικά σε αυτόν τον browser. Δεν υπάρχει πραγματική VoIP, ηχογράφηση, SMS provider ή cloud sync.
        </p>
      </div>
    </div>
  );
}
