'use client';

import { useState } from 'react';
import type { Offer } from '@/lib/types';

const REJECTION_REASONS = [
  'Η τιμή είναι υψηλή',
  'Δεν είναι η κατάλληλη στιγμή',
  'Βρήκα άλλη λύση',
  'Άλλο',
];

interface Props {
  offer: Offer;
  onUpdateOffer: (updated: Offer) => void;
}

export default function OfferAcceptanceDemoSection({ offer, onUpdateOffer }: Props) {
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle');
  const [rejectionReason, setRejectionReason] = useState(REJECTION_REASONS[0]);
  const [rejectionComment, setRejectionComment] = useState('');

  // Demo link — only computed on client (OfferPreview gates on hydrated so window is available).
  const demoLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/offer-response/${offer.id}`
      : `/offer-response/${offer.id}`;

  const isSettled = offer.status === 'accepted' || offer.status === 'rejected';

  function handleCopy() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(demoLink).then(
        () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
        () => fallbackCopy()
      );
    } else {
      fallbackCopy();
    }
  }

  function fallbackCopy() {
    const el = document.createElement('input');
    el.value = demoLink;
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    document.body.removeChild(el);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleAccept() {
    const now = new Date().toISOString();
    const note = 'Αποδοχή demo μέσω link πελάτη.';
    onUpdateOffer({
      ...offer,
      status: 'accepted',
      notes: offer.notes ? `${offer.notes}\n${note}` : note,
      updatedAt: now,
    });
  }

  function handleRejectConfirm() {
    const now = new Date().toISOString();
    let note = `Απόρριψη demo: ${rejectionReason}.`;
    if (rejectionComment.trim()) note += ` ${rejectionComment.trim()}`;
    onUpdateOffer({
      ...offer,
      status: 'rejected',
      notes: offer.notes ? `${offer.notes}\n${note}` : note,
      updatedAt: now,
    });
    setMode('idle');
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 print:hidden">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Link αποδοχής πελάτη
        </p>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
          Demo
        </span>
      </div>

      {/* Demo link row */}
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-500">
          {demoLink}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-medium transition ${
            copied
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50'
          }`}
        >
          {copied ? 'Αντιγράφηκε' : 'Αντιγραφή'}
        </button>
      </div>

      {/* Open demo link */}
      <div className="mb-4 space-y-1.5">
        <a
          href={demoLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Άνοιγμα demo link πελάτη
        </a>
        <p className="text-xs text-zinc-400">
          Το demo link λειτουργεί μόνο με τα τοπικά δεδομένα αυτού του browser.
        </p>
        <p className="text-xs text-zinc-400">
          Στην πραγματική έκδοση ο πελάτης θα ανοίγει δημόσια σελίδα και θα πατάει αποδοχή ή απόρριψη.
        </p>
      </div>

      {/* Settled state */}
      {isSettled && (
        <div
          className={`rounded-xl px-3 py-2.5 text-sm font-medium ring-1 ${
            offer.status === 'accepted'
              ? 'bg-green-50 text-green-700 ring-green-200'
              : 'bg-red-50 text-red-700 ring-red-200'
          }`}
        >
          {offer.status === 'accepted'
            ? 'Η προσφορά έχει γίνει αποδεκτή.'
            : 'Η προσφορά έχει απορριφθεί.'}
        </div>
      )}

      {/* Simulation buttons — shown only if not yet settled */}
      {!isSettled && mode === 'idle' && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleAccept}
            className="flex-1 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
          >
            Προσομοίωση αποδοχής
          </button>
          <button
            type="button"
            onClick={() => setMode('rejecting')}
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            Προσομοίωση απόρριψης
          </button>
        </div>
      )}

      {/* Rejection reason picker */}
      {!isSettled && mode === 'rejecting' && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-zinc-700">Λόγος απόρριψης:</p>
          <div className="flex flex-col gap-1.5">
            {REJECTION_REASONS.map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="rejection-reason"
                  value={r}
                  checked={rejectionReason === r}
                  onChange={() => setRejectionReason(r)}
                  className="accent-red-600"
                />
                <span className="text-sm text-zinc-700">{r}</span>
              </label>
            ))}
          </div>
          <textarea
            value={rejectionComment}
            onChange={(e) => setRejectionComment(e.target.value)}
            placeholder="Σχόλιο (προαιρετικό)..."
            rows={2}
            className="w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRejectConfirm}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              Επιβεβαίωση απόρριψης
            </button>
            <button
              type="button"
              onClick={() => setMode('idle')}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              Ακύρωση
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
