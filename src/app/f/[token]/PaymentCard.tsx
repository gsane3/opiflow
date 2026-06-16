'use client';

// Inline payment declaration for the public portal. Shows the requested amount +
// the business IBAN to pay to, and a «Δήλωσα την κατάθεση» button that records the
// customer's self-report (pending → declared). The folder token in the URL is the
// only credential; the server re-scopes everything to that token. The app NEVER
// moves money — the customer deposits directly and self-reports; the owner confirms.

import { useState } from 'react';

const KIND_LABELS: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };

export default function PaymentCard({
  token,
  payment,
}: {
  token: string;
  payment: { id: string; kind: string; amount: number; currency: string; status: string; receivingAccount: string | null };
}) {
  const [status, setStatus] = useState(payment.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function declare() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentRequestId: payment.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json?.ok) setStatus('declared');
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const amount = `€${payment.amount.toLocaleString('el-GR')}`;
  const kind = KIND_LABELS[payment.kind] ?? payment.kind;

  return (
    <li className="rounded-xl bg-zinc-50 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-900">{kind}</p>
        <span className="shrink-0 text-base font-semibold tabular-nums text-zinc-900">{amount}</span>
      </div>
      {payment.receivingAccount && (
        <p className="mt-1 break-all text-xs text-zinc-500">
          IBAN: <span className="font-mono text-zinc-700">{payment.receivingAccount}</span>
        </p>
      )}

      {status === 'confirmed' ? (
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-green-700">
          <span aria-hidden>✓</span> Επιβεβαιώθηκε
        </p>
      ) : status === 'declared' ? (
        <p className="mt-2 text-sm font-medium text-blue-700">Λάβαμε τη δήλωσή σας — αναμονή επιβεβαίωσης.</p>
      ) : (
        <div className="mt-2">
          <button
            type="button"
            onClick={declare}
            disabled={busy}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Γίνεται…' : 'Δήλωσα την κατάθεση'}
          </button>
          {error && <p className="mt-1 text-xs text-red-600">Κάτι πήγε στραβά. Δοκιμάστε ξανά.</p>}
        </div>
      )}
    </li>
  );
}
