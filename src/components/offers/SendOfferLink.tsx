'use client';

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { BusinessProfile } from '@/lib/types';

interface Props {
  offerId: string;
  bp: BusinessProfile | null;
  /** Called after a successful send so the parent can refresh the offer status. */
  onSent?: () => void;
}

type Phase = 'preparing' | 'ready' | 'sending' | 'sent' | 'fallback' | 'error';

function senderName(bp: BusinessProfile | null): string {
  if (!bp) return '';
  const full = [bp.ownerFirstName, bp.ownerLastName].filter(Boolean).join(' ').trim();
  return bp.ownerName?.trim() || full;
}

// The editable default message: greeting + link + a friendly signature, exactly
// the shape the owner asked for.
function buildDefaultMessage(link: string, bp: BusinessProfile | null): string {
  const name = senderName(bp);
  const company = (bp?.tradeName || bp?.businessName || bp?.legalName || '').trim();
  const lines = ['Καλησπέρα, σας στέλνω την προσφορά όπως συζητήσαμε:', link, '', 'Φιλικά,'];
  if (name) lines.push(name);
  if (company) lines.push(company);
  lines.push('μέσω opiflow.ai');
  return lines.join('\n');
}

const FALLBACK_REASON: Record<string, string> = {
  missing_mobile: 'Ο πελάτης δεν έχει κινητό για Viber/SMS.',
  missing_customer: 'Η προσφορά δεν είναι συνδεδεμένη με πελάτη.',
  provider_unavailable: 'Η αυτόματη αποστολή (Viber/SMS) δεν είναι ρυθμισμένη στον server.',
  provider_failed: 'Η αποστολή απέτυχε από τον πάροχο.',
};

export default function SendOfferLink({ offerId, bp, onSent }: Props) {
  const [phase, setPhase] = useState<Phase>('preparing');
  const [responseUrl, setResponseUrl] = useState('');
  const [recipient, setRecipient] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [copied, setCopied] = useState(false);

  const getToken = useCallback(async () => {
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  // Create a fresh response token + draft (no send) and pre-fill the message.
  const prepare = useCallback(async () => {
    setPhase('preparing');
    setError('');
    const token = await getToken();
    if (!token) { setPhase('error'); setError('Δεν είσαι συνδεδεμένος.'); return; }
    try {
      const resp = await fetch(`/api/offers/${offerId}/notify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'draft' }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok || !data.responseUrl) {
        setPhase('error'); setError('Αποτυχία δημιουργίας συνδέσμου.'); return;
      }
      setResponseUrl(data.responseUrl as string);
      setRecipient((data.recipient as string | null) ?? null);
      setMessage(buildDefaultMessage(data.responseUrl as string, bp));
      setPhase('ready');
    } catch {
      setPhase('error'); setError('Αποτυχία δημιουργίας συνδέσμου.');
    }
  }, [offerId, bp, getToken]);

  useEffect(() => { void prepare(); }, [prepare]);

  async function send() {
    setPhase('sending');
    setError(''); setReason('');
    const token = await getToken();
    if (!token) { setPhase('error'); setError('Δεν είσαι συνδεδεμένος.'); return; }
    try {
      const resp = await fetch(`/api/offers/${offerId}/notify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'send', responseUrl, message }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok && data.sent) {
        setPhase('sent');
        onSent?.();
      } else if (resp.ok && data.ok && data.status === 'fallback_required') {
        setReason((data.reason as string) ?? '');
        setPhase('fallback');
      } else if (data.error === 'link_expired') {
        setError('Ο σύνδεσμος είχε λήξει — δημιουργήθηκε νέος. Δοκίμασε ξανά.');
        await prepare();
      } else {
        setPhase('error'); setError('Αποτυχία αποστολής. Δοκίμασε ξανά.');
      }
    } catch {
      setPhase('error'); setError('Αποτυχία αποστολής. Δοκίμασε ξανά.');
    }
  }

  function copyLink() {
    if (!responseUrl || !navigator.clipboard) return;
    navigator.clipboard.writeText(responseUrl).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => {},
    );
  }

  function copyMessage() {
    if (!message || !navigator.clipboard) return;
    navigator.clipboard.writeText(message).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => {},
    );
  }

  const busy = phase === 'preparing' || phase === 'sending';

  return (
    <section className="rounded-2xl bg-white dark:bg-[#17232f] p-4 shadow-sm ring-1 ring-zinc-100 dark:ring-white/10 print:hidden space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Αποστολή στον πελάτη
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Στέλνει τον σύνδεσμο αποδοχής μέσω Viber (με fallback σε SMS). Μπορείς να επεξεργαστείς το μήνυμα πριν την αποστολή.
        </p>
      </div>

      {phase === 'sent' ? (
        <div className="rounded-xl bg-green-50 dark:bg-green-500/15 px-4 py-3 ring-1 ring-green-200 dark:ring-green-500/20">
          <p className="text-sm font-semibold text-green-700 dark:text-green-300">✓ Ο σύνδεσμος στάλθηκε στον πελάτη.</p>
          <button type="button" onClick={() => void prepare()} className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-700">
            Επαναποστολή
          </button>
        </div>
      ) : (
        <>
          {recipient ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Παραλήπτης: <span className="font-medium text-zinc-700 dark:text-zinc-200">{recipient}</span></p>
          ) : phase === 'ready' ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">Δεν βρέθηκε κινητό πελάτη — μπορείς να αντιγράψεις τον σύνδεσμο και να τον στείλεις χειροκίνητα.</p>
          ) : null}

          <textarea
            rows={7}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={busy ? 'Δημιουργία συνδέσμου…' : ''}
            className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-500/20 disabled:opacity-60"
          />

          {phase === 'fallback' && (
            <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 px-4 py-3 ring-1 ring-amber-200 dark:ring-amber-500/20 space-y-2">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Δεν στάλθηκε αυτόματα: {FALLBACK_REASON[reason] ?? 'Δεν ήταν δυνατή η αποστολή.'} Αντίγραψε το μήνυμα και στείλ’ το χειροκίνητα.
              </p>
              <button type="button" onClick={copyMessage} className="rounded-lg border border-amber-300 dark:border-amber-500/30 bg-white dark:bg-[#17232f] px-3 py-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300 transition hover:bg-amber-100 dark:hover:bg-white/5">
                {copied ? 'Αντιγράφηκε' : 'Αντιγραφή μηνύματος'}
              </button>
            </div>
          )}

          {(phase === 'error' || error) && (
            <p className="text-xs text-red-600 dark:text-red-400">{error || 'Κάτι πήγε στραβά.'}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !responseUrl}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'sending' ? 'Αποστολή…' : 'Αποστολή (Viber/SMS)'}
            </button>
            <a
              href={responseUrl || undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!responseUrl}
              className={`inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5 ${!responseUrl ? 'pointer-events-none opacity-50' : ''}`}
            >
              Προβολή link πελάτη
            </a>
            <button
              type="button"
              onClick={copyLink}
              disabled={!responseUrl}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-50"
            >
              {copied ? 'Αντιγράφηκε' : 'Αντιγραφή link'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
