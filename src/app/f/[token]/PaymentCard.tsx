'use client';

// Inline payment declaration for the public portal. Shows the requested amount +
// the business bank details to pay to (δικαιούχος + IBAN, each with a copy
// button), and a «Δήλωσα την κατάθεση» button that records the customer's
// self-report (pending → declared). The folder token in the URL is the only
// credential; the server re-scopes everything to that token. The app NEVER moves
// money — the customer deposits directly and self-reports; the owner confirms.

import { useState } from 'react';

const KIND_LABELS: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — value is still visible to copy manually */
    }
  }
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-zinc-200">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">{label}</p>
        <p className="truncate font-mono text-sm text-zinc-800">{value}</p>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-200 active:scale-95"
      >
        {copied ? 'Αντιγράφηκε ✓' : 'Αντιγραφή'}
      </button>
    </div>
  );
}

export default function PaymentCard({
  token,
  payment,
  bankName,
  beneficiary,
}: {
  token: string;
  payment: { id: string; kind: string; amount: number; currency: string; status: string; receivingAccount: string | null };
  bankName?: string | null;
  beneficiary?: string | null;
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
  // Bank details are only actionable while the request is still pending (the
  // customer needs them to make the deposit). Once declared/confirmed, hide them.
  const showBank = status === 'pending' && (beneficiary || payment.receivingAccount);

  return (
    <li className="rounded-xl bg-zinc-50 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-900">{kind}</p>
        <span className="shrink-0 text-base font-semibold tabular-nums text-zinc-900">{amount}</span>
      </div>

      {showBank && (
        <div className="mt-2">
          <p className="text-xs text-zinc-500">Κατάθεση στον λογαριασμό:</p>
          {bankName && (
            <p className="mt-1 text-xs text-zinc-500">
              Τράπεζα: <span className="font-medium text-zinc-700">{bankName}</span>
            </p>
          )}
          {beneficiary && <CopyField label="Δικαιούχος" value={beneficiary} />}
          {payment.receivingAccount && <CopyField label="IBAN" value={payment.receivingAccount} />}
        </div>
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
