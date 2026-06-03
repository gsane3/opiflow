'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { RequireAdmin } from '@/components/admin/RequireAdmin';

interface CustomerDto {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  source: string | null;
  status: string;
  preferredContactMethod: string;
  lastContactAt: string | null;
  createdAt: string;
}

interface CustomersApiResponse {
  ok: boolean;
  customers?: CustomerDto[];
  count?: number;
  error?: string;
}

function maskPhone(phone: string | null): string {
  if (!phone) return 'No phone';
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`;
}

function formatDate(value: string | null): string {
  if (!value) return 'No date';
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

function customerTitle(customer: CustomerDto): string {
  return customer.name ?? customer.companyName ?? customer.crmNumber ?? 'Customer';
}

function BackendCustomersListPageInner() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Press load to view backend customers.');
  const [customers, setCustomers] = useState<CustomerDto[]>([]);

  async function loadCustomers() {
    setLoading(true);
    setMessage('Loading...');

    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session?.access_token) {
        setCustomers([]);
        setMessage('No active Supabase session. Login at /login/backend first.');
        return;
      }

      const response = await fetch('/api/customers?limit=50', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const json = (await response.json()) as CustomersApiResponse;

      if (!response.ok || !json.ok) {
        setCustomers([]);
        setMessage(`Customers API error: ${json.error ?? response.status}`);
        return;
      }

      setCustomers(json.customers ?? []);
      setMessage(`Loaded ${json.count ?? 0} backend customers.`);
    } catch (err) {
      setCustomers([]);
      setMessage(err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Backend test
          </p>
          <h1 className="mt-1 text-xl font-semibold text-zinc-900">
            Backend customers
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Reads customers from /api/customers with Supabase auth token.
          </p>
        </div>
        <Link href="/backend" className="text-sm font-semibold text-zinc-500 hover:text-zinc-900">
          Back to hub
        </Link>
      </div>

      <button
        type="button"
        onClick={loadCustomers}
        disabled={loading}
        className="rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Loading...' : 'Load customers'}
      </button>

      <p className="text-sm text-zinc-500">{message}</p>

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <p className="text-sm font-semibold text-zinc-900">Customers</p>
        </div>

        {customers.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            No customers loaded.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {customers.map((customer) => (
              <li key={customer.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/customers/backend/${customer.id}`}
                      className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                    >
                      {customerTitle(customer)}
                    </Link>
                    <p className="mt-1 text-xs text-zinc-500">
                      {customer.crmNumber ?? 'No CRM number'} | {customer.source ?? 'no source'} | {customer.status}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {maskPhone(customer.phone)} | {customer.email ?? 'No email'}
                    </p>
                  </div>

                  <div className="text-right text-xs text-zinc-400">
                    <p>Last contact</p>
                    <p>{formatDate(customer.lastContactAt)}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default function BackendCustomersListPage() {
  return (
    <RequireAdmin>
      <BackendCustomersListPageInner />
    </RequireAdmin>
  );
}
