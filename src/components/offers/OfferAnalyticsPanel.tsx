'use client';

import { useState } from 'react';
import type { Offer } from '@/lib/types';

function extractRejectionReason(notes: string): string {
  const line = notes.split('\n').find((l) => l.includes('Απόρριψη demo:'));
  if (!line) return '';
  const idx = line.indexOf('Απόρριψη demo:');
  return line.slice(idx + 'Απόρριψη demo:'.length).trim();
}

interface Props {
  offers: Offer[];
}

export default function OfferAnalyticsPanel({ offers }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (offers.length === 0) return null;

  const total = offers.length;
  const draft = offers.filter((o) => o.status === 'draft').length;
  const ready = offers.filter((o) => o.status === 'ready_to_send').length;
  const sentManually = offers.filter((o) => o.status === 'sent_manually').length;
  const accepted = offers.filter((o) => o.status === 'accepted').length;
  const rejected = offers.filter((o) => o.status === 'rejected').length;
  const expired = offers.filter((o) => o.status === 'expired').length;
  const sent = sentManually + accepted + rejected;
  const acceptanceRate = sent > 0 ? Math.round((accepted / sent) * 100) : 0;
  const rejectedOffers = offers.filter((o) => o.status === 'rejected');

  return (
    <div className="mb-4 rounded-2xl bg-white ring-1 ring-zinc-100 shadow-sm overflow-hidden">
      {/* Compact summary row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-zinc-50"
      >
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-zinc-900">{total} προσφορές</span>
          {sent > 0 && (
            <span className="text-sm text-zinc-500">{sent} εστάλησαν</span>
          )}
          {sent > 0 && (
            <span className={`text-sm font-semibold ${acceptanceRate > 0 ? 'text-green-600' : 'text-zinc-400'}`}>
              {acceptanceRate}% αποδοχή
            </span>
          )}
          {/* Quick pill breakdown */}
          <div className="hidden sm:flex items-center gap-1.5">
            {draft > 0 && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">{draft} πρόχ.</span>
            )}
            {ready > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">{ready} έτ.</span>
            )}
            {accepted > 0 && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">{accepted} αποδ.</span>
            )}
            {expired > 0 && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-400">{expired} ληγ.</span>
            )}
          </div>
        </div>
        <svg
          className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-zinc-100 px-4 py-4 space-y-3">
          {/* Status pills */}
          <div className="flex flex-wrap gap-2">
            {draft > 0 && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600">{draft} Πρόχειρες</span>
            )}
            {ready > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">{ready} Έτοιμες</span>
            )}
            {sentManually > 0 && (
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">{sentManually} Στάλθηκαν</span>
            )}
            {accepted > 0 && (
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">{accepted} Αποδεκτές</span>
            )}
            {rejected > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">{rejected} Απορρίφθηκαν</span>
            )}
            {expired > 0 && (
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-400">{expired} Ληγμένες</span>
            )}
          </div>

          {/* Rejection insights */}
          {rejectedOffers.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Λόγοι απόρριψης
              </p>
              <ul className="space-y-1.5">
                {rejectedOffers.map((offer) => {
                  const reason = extractRejectionReason(offer.notes);
                  return (
                    <li key={offer.id} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 shrink-0 text-red-400">
                        <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-zinc-700">{offer.offerNumber}</span>
                        {' — '}
                        <span className="text-zinc-500">
                          {reason || 'Δεν έχει καταγραφεί λόγος.'}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
