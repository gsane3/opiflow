'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface CustomerDto {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
}

interface CommunicationDto {
  id: string;
  customerId: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  createdAt: string;
  customer: CustomerDto | null;
}

interface ApiResponse {
  ok: boolean;
  communications?: CommunicationDto[];
  count?: number;
  error?: string;
}

function maskPhone(phone: string | null): string {
  if (!phone) return 'Χωρίς αριθμό';
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function customerTitle(customer: CustomerDto | null): string {
  if (!customer) return 'No linked customer';
  return customer.name ?? customer.companyName ?? customer.crmNumber ?? 'Linked customer';
}

export default function CommunicationsBackendPage() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>('Πάτησε φόρτωση για να δεις τις πρόσφατες πραγματικές κλήσεις.');
  const [items, setItems] = useState<CommunicationDto[]>([]);

  async function loadRecentCalls() {
    setLoading(true);
    setMessage('Φόρτωση...');

    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session?.access_token) {
        setItems([]);
        setMessage('Δεν υπάρχει ενεργό Supabase session. Κάνε login από /login/backend πρώτα.');
        return;
      }

      const res = await fetch('/api/communications?channel=call&direction=inbound&limit=10', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok || !json.ok) {
        setItems([]);
        setMessage(`API error: ${json.error ?? res.status}`);
        return;
      }

      setItems(json.communications ?? []);
      setMessage(`Βρέθηκαν ${json.count ?? 0} επικοινωνίες.`);
    } catch (err) {
      setItems([]);
      setMessage(err instanceof Error ? err.message : 'Άγνωστο σφάλμα.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Backend test
        </p>
        <h1 className="mt-1 text-xl font-semibold text-zinc-900">
          Πραγματικές PBX κλήσεις
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          Διαβάζει από το νέο /api/communications endpoint με Supabase auth token.
        </p>
      </div>

      <button
        type="button"
        onClick={loadRecentCalls}
        disabled={loading}
        className="rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Φόρτωση...' : 'Φόρτωση πρόσφατων κλήσεων'}
      </button>

      <p className="text-sm text-zinc-500">{message}</p>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        {items.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν δεδομένα για εμφάνιση.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {items.map((item) => (
              <li key={item.id} className="space-y-1 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-zinc-900">
                    {maskPhone(item.phone)}
                  </p>
                  <p className="shrink-0 text-xs text-zinc-400">
                    {formatDate(item.createdAt)}
                  </p>
                </div>
                <p className="text-xs text-zinc-500">
                  {item.channel} · {item.direction} · {item.status}
                </p>
                {item.customer ? (
                  <>
                    <Link
                      href={`/customers/backend/${item.customer.id}`}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      Customer: {customerTitle(item.customer)}
                    </Link>
                    <p className="text-xs text-zinc-400">
                      {item.customer.crmNumber ?? 'No CRM number'} | {item.customer.source ?? 'no source'} | {item.customer.status ?? 'no status'}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-zinc-500">
                    Customer: {customerTitle(item.customer)}
                  </p>
                )}
                {item.summary ? (
                  <p className="break-words text-xs text-zinc-400">{item.summary}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
