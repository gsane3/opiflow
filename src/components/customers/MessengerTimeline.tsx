'use client';

// Messenger-style customer chat (redesign P3b). Reads the unified per-customer
// stream from GET /api/customers/[id]/timeline and renders it as chat bubbles —
// our side right, the customer left, like Facebook Messenger. Call bubbles expand
// to show the AI brief ("πατήστε για περίληψη"). This is the read view; the ➕
// composer + AI mic + interactive actions land in P3c/P3d. Self-contained and
// additive — it does not touch the existing customer card.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type Side = 'us' | 'customer';
interface TimelineItem {
  id: string;
  type: string;
  side: Side;
  interactive: boolean;
  title: string;
  body: string | null;
  status: string | null;
  occurredAt: string;
  refTable: string | null;
  refId: string | null;
  payload?: Record<string, unknown>;
}

interface CustomerLite {
  id: string;
  name: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  address: string | null;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { Authorization: `Bearer ${session.access_token}` };
  } catch {
    return null;
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const TYPE_ICON: Record<string, string> = {
  call: '📞', sms: '💬', viber: '💜', email: '✉️',
  offer: '📄', offer_response: '✅',
  appointment: '📅', appointment_response: '🗓️',
  intake_request: '📋', intake_submitted: '✅', upload: '📎',
};

export default function MessengerTimeline({ customerId }: { customerId: string }) {
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setError('Συνδέσου ξανά.'); setLoading(false); return; }
    try {
      const [cRes, tRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`, { headers }),
        fetch(`/api/customers/${customerId}/timeline`, { headers }),
      ]);
      const cJson = await cRes.json().catch(() => ({}));
      const tJson = await tRes.json().catch(() => ({}));
      if (cJson?.ok && cJson.customer) setCustomer(cJson.customer as CustomerLite);
      if (tJson?.ok && Array.isArray(tJson.items)) {
        setItems(tJson.items as TimelineItem[]);
      } else if (!tJson?.ok) {
        setError('Δεν φορτώθηκε η συνομιλία.');
      }
    } catch {
      setError('Δεν φορτώθηκε η συνομιλία.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { void load(); }, [load]);

  const name = customer?.name ?? 'Πελάτης';
  const dialNumber = customer?.mobilePhone || customer?.phone || customer?.landlinePhone || null;

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-2xl flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-200 bg-white/90 px-4 py-3 backdrop-blur">
        <Link href={`/customers/${customerId}`} aria-label="Πίσω" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100">
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
        </Link>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <p className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-900">{name}</p>
        {dialNumber && (
          <a href={`tel:${dialNumber}`} aria-label="Κλήση" className="flex h-9 w-9 items-center justify-center rounded-full text-indigo-600 transition hover:bg-indigo-50">
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
          </a>
        )}
        <Link href={`/customers/${customerId}`} aria-label="Στοιχεία" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100">
          <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" /></svg>
        </Link>
      </header>

      {/* Chat body */}
      <div className="flex-1 space-y-2 bg-[#F5F5F7] px-3 py-4">
        {loading ? (
          <p className="py-10 text-center text-sm text-zinc-400">Φόρτωση συνομιλίας…</p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-red-500">{error}</p>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">Καμία δραστηριότητα ακόμα.</p>
        ) : (
          items.map((it) => {
            const mine = it.side === 'us';
            const icon = TYPE_ICON[it.type] ?? '•';
            const isCall = it.type === 'call';
            const hasBrief = isCall && Boolean(it.payload?.hasBrief) && Boolean(it.body);
            const isOpen = expanded.has(it.id);
            return (
              <div key={it.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ring-1 ${
                    mine ? 'bg-indigo-600 text-white ring-indigo-600/10' : 'bg-white text-zinc-900 ring-zinc-200/70'
                  } ${isCall || hasBrief ? 'cursor-pointer' : ''}`}
                  onClick={() => hasBrief && toggle(it.id)}
                >
                  <p className={`flex items-center gap-1.5 font-medium ${mine ? 'text-white' : 'text-zinc-900'}`}>
                    <span aria-hidden>{icon}</span>
                    <span>{it.title}</span>
                  </p>
                  {isCall ? (
                    hasBrief ? (
                      isOpen ? (
                        <p className={`mt-1 whitespace-pre-wrap text-[13px] leading-relaxed ${mine ? 'text-indigo-50' : 'text-zinc-600'}`}>{it.body}</p>
                      ) : (
                        <p className={`mt-0.5 text-[12px] ${mine ? 'text-indigo-100' : 'text-indigo-600'}`}>Πατήστε για περίληψη</p>
                      )
                    ) : null
                  ) : it.body ? (
                    <p className={`mt-1 whitespace-pre-wrap text-[13px] leading-relaxed ${mine ? 'text-indigo-50' : 'text-zinc-600'}`}>{it.body}</p>
                  ) : null}
                  <p className={`mt-1 text-[10px] ${mine ? 'text-indigo-200' : 'text-zinc-400'}`}>{fmtTime(it.occurredAt)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer (visual placeholder — actions land in P3c/P3d) */}
      <div className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-zinc-200 bg-white px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
        <button type="button" disabled aria-label="Ενέργειες" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-300">
          <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
        </button>
        <div className="flex-1 rounded-full bg-zinc-100 px-4 py-2.5 text-sm text-zinc-400">Σύντομα: γράψε ή μίλα στον βοηθό…</div>
        <button type="button" disabled aria-label="Φωνητικός βοηθός" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-300">
          <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" /></svg>
        </button>
      </div>
    </div>
  );
}
