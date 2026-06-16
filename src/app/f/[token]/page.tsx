// Public customer view of a Έργο (work folder) — /f/[token].
// No login. Server-rendered, mobile-first, read-only. The token is validated
// server-side (service-role); an invalid/expired/revoked token shows a neutral
// "link unavailable" message. Only safe, customer-facing data is rendered.

import { loadPublicFolder, type PublicFolderView } from '@/lib/server/public-folder';
import QuestionForm from './QuestionForm';
import Stepper from '@/components/customers/Stepper';
import OfferAcceptButton from './OfferAcceptButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  Νέο: 'bg-indigo-50 text-indigo-700',
  'Σε εξέλιξη': 'bg-amber-50 text-amber-700',
  Ολοκληρώθηκε: 'bg-green-50 text-green-700',
  Αρχειοθετήθηκε: 'bg-zinc-100 text-zinc-600',
};

function formatDate(date: string | null): string {
  if (!date) return '';
  const [y, m, d] = date.split('T')[0].split('-');
  return y && m && d ? `${d}-${m}-${y}` : date;
}

function Unavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F5F7] p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200/60">
        <p className="text-base font-medium text-zinc-700">Ο σύνδεσμος δεν είναι πλέον διαθέσιμος.</p>
        <p className="mt-2 text-sm text-zinc-500">Επικοινωνήστε μαζί μας αν χρειάζεστε βοήθεια.</p>
      </div>
    </main>
  );
}

export default async function FolderPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view: PublicFolderView | null = await loadPublicFolder(token);

  if (!view) return <Unavailable />;

  const tone = STATUS_TONE[view.statusLabel] ?? 'bg-zinc-100 text-zinc-600';

  return (
    <main className="min-h-screen bg-[#F5F5F7] px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        {/* Business header */}
        {view.business && (
          <header className="flex items-center gap-3 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
            {view.business.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.business.logoUrl} alt={view.business.name} className="h-12 w-12 rounded-xl object-contain" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-lg font-bold text-indigo-700">
                {view.business.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-zinc-900">{view.business.name}</p>
              {view.business.phone && <p className="truncate text-sm text-zinc-500">{view.business.phone}</p>}
            </div>
          </header>
        )}

        {/* Folder */}
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Το έργο σας</p>
          <h1 className="mt-1 text-xl font-bold text-zinc-900">{view.title}</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{view.statusLabel}</span>
            {view.statusMessage && <span className="text-sm text-zinc-500">{view.statusMessage}</span>}
          </div>
          <div className="mt-4">
            <Stepper step={view.step} />
          </div>
        </section>

        {/* Offers */}
        {view.offers.length > 0 && (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-200/60">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Προσφορές</p>
            <ul className="mt-2 space-y-2">
              {view.offers.map((o) => (
                <li key={o.id} className="rounded-xl bg-zinc-50 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{o.offerNumber}</p>
                      <p className="text-xs text-zinc-500">{o.statusLabel}</p>
                    </div>
                    {typeof o.total === 'number' && (
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-800">€{o.total.toLocaleString('el-GR')}</span>
                    )}
                  </div>
                  {o.canAccept && <OfferAcceptButton token={token} offerId={o.id} />}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Appointments */}
        {view.appointments.length > 0 && (
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-200/60">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Ραντεβού</p>
            <ul className="mt-2 space-y-2">
              {view.appointments.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2.5">
                  <span className="text-sm font-medium text-zinc-900">
                    {formatDate(a.date)}
                    {a.time ? ` · ${a.time}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">{a.typeLabel}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Empty placeholder when nothing is linked yet */}
        {view.offers.length === 0 && view.appointments.length === 0 && (
          <section className="rounded-3xl bg-white p-5 text-center shadow-sm ring-1 ring-zinc-200/60">
            <p className="text-sm text-zinc-500">Δεν υπάρχει κάτι ακόμα. Θα ενημερωθείτε για κάθε νεότερο.</p>
          </section>
        )}

        {/* Ask a question about this job */}
        <QuestionForm token={token} />

        <p className="px-2 pt-2 text-center text-xs text-zinc-400">Επικοινωνήστε μαζί μας αν χρειάζεστε βοήθεια.</p>
      </div>
    </main>
  );
}
