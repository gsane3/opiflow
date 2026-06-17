'use client';

// Branded, printable offer document for the customer portal. Read-only — accept /
// «Έχω απορία» live on the folder page. The «Αποθήκευση ως PDF» button uses the
// browser print dialog (print:hidden hides the chrome). Data is the safe view
// from loadPublicOffer (already token-scoped server-side).

import Link from 'next/link';
import type { PublicOfferView } from '@/lib/server/public-offer';

function eur(n: number | null): string {
  return typeof n === 'number'
    ? `${n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : '—';
}
function fmtDate(s: string | null): string {
  if (!s) return '—';
  const [y, m, d] = s.split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
}

export default function PublicOfferDoc({ token, view }: { token: string; view: PublicOfferView }) {
  const b = view.business;
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-5 print:py-0 print:max-w-none">
      {/* Clean print/PDF output: white background, no shadows, keep brand colours,
          and never split the totals across a page. */}
      <style>{`
        @media print {
          @page { margin: 12mm; }
          html, body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .offer-totals, .offer-bank { break-inside: avoid; }
        }
      `}</style>
      {/* chrome (hidden on print) */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link href={`/f/${encodeURIComponent(token)}`} className="inline-flex min-h-[44px] items-center text-sm font-medium text-zinc-500 hover:text-zinc-700">
          ← Πίσω στο έργο
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
          </svg>
          Αποθήκευση ως PDF
        </button>
      </div>

      <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100 print:rounded-none print:p-0 print:shadow-none print:ring-0">
        {/* header: business branding + offer meta */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div>
            {b?.logoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={b.logoUrl} alt="Logo" className="mb-2 h-12 w-auto object-contain" />
            )}
            {b && (
              <>
                <p className="text-base font-bold text-zinc-900">{b.primaryName}</p>
                {b.tradeName && <p className="text-sm text-zinc-500">{b.tradeName}</p>}
                {b.phone && <p className="text-sm text-zinc-500">{b.phone}</p>}
                {b.email && <p className="text-sm text-zinc-500">{b.email}</p>}
                {b.website && <p className="text-sm text-zinc-500">{b.website}</p>}
                {b.addressLines.map((l, i) => (
                  <p key={i} className="text-sm text-zinc-500">{l}</p>
                ))}
                {b.vatNumber && <p className="text-sm text-zinc-500">ΑΦΜ: {b.vatNumber}</p>}
                {b.taxOffice && <p className="text-sm text-zinc-500">ΔΟΥ: {b.taxOffice}</p>}
              </>
            )}
          </div>
          <div className="sm:text-right">
            <p className="text-xl font-bold text-zinc-900">ΠΡΟΣΦΟΡΑ {view.offerNumber}</p>
            <p className="mt-1 text-sm text-zinc-500">Ημερομηνία: {fmtDate(view.offerDate)}</p>
            <p className="text-sm text-zinc-500">Ισχύει μέχρι: {fmtDate(view.validUntil)}</p>
            <span className="mt-2 inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">{view.statusLabel}</span>
          </div>
        </div>

        {/* line items */}
        {view.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-1/2" />
                <col className="w-[10%]" />
                <col className="w-[22%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-400">
                  <th className="pb-2 text-left font-medium">Περιγραφή</th>
                  <th className="pb-2 text-right font-medium">Ποσ.</th>
                  <th className="pb-2 text-right font-medium">Τιμή</th>
                  <th className="pb-2 text-right font-medium">Σύνολο</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((it, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    <td className="break-words py-2 pr-2 text-zinc-800">{it.description}</td>
                    <td className="py-2 text-right text-zinc-600">{it.quantity}</td>
                    <td className="py-2 text-right text-zinc-600">{eur(it.unitPrice)}</td>
                    <td className="py-2 text-right font-medium text-zinc-800">{eur(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* totals */}
        <div className="offer-totals flex justify-end">
          <div className="w-full max-w-[16rem] space-y-1 text-sm">
            <div className="flex justify-between text-zinc-500"><span>Καθαρή αξία</span><span>{eur(view.subtotal)}</span></div>
            <div className="flex justify-between text-zinc-500"><span>ΦΠΑ {view.vatRate ?? 0}%</span><span>{eur(view.vatAmount)}</span></div>
            <div className="flex justify-between border-t border-zinc-200 pt-1.5 font-bold text-zinc-900"><span>ΣΥΝΟΛΟ</span><span>{eur(view.total)}</span></div>
          </div>
        </div>

        {view.notes && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Σημειώσεις</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600">{view.notes}</p>
          </div>
        )}
        {view.terms && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Όροι</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600">{view.terms}</p>
          </div>
        )}

        {/* bank block — where the customer deposits */}
        {b?.bankIban && (
          <div className="offer-bank rounded-xl bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Στοιχεία πληρωμής</p>
            <div className="mt-1 space-y-0.5 text-sm text-zinc-700">
              {b.bankBeneficiary && <p>Δικαιούχος: {b.bankBeneficiary}</p>}
              {b.bankName && <p>Τράπεζα: {b.bankName}</p>}
              <p className="font-mono tracking-wide">IBAN: {b.bankIban}</p>
            </div>
          </div>
        )}

        {view.acceptanceText && (
          <div className="rounded-xl border border-dashed border-zinc-300 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Κείμενο αποδοχής</p>
            <p className="mt-1 text-sm text-zinc-600">{view.acceptanceText}</p>
          </div>
        )}
      </div>
    </main>
  );
}
