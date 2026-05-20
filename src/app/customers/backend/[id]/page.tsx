'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

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
  notes: string | null;
  createdAt: string;
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
}

interface CustomerApiResponse {
  ok: boolean;
  customer?: CustomerDto;
  error?: string;
}

interface CommunicationsApiResponse {
  ok: boolean;
  communications?: CommunicationDto[];
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

export default function BackendCustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Press load to view this backend customer.');
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [communications, setCommunications] = useState<CommunicationDto[]>([]);

  async function loadCustomer() {
    setLoading(true);
    setMessage('Loading...');

    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase.auth.getSession();
      const session = data.session;

      if (!session?.access_token) {
        setCustomer(null);
        setCommunications([]);
        setMessage('No active Supabase session. Login at /login/backend first.');
        return;
      }

      const headers = {
        Authorization: `Bearer ${session.access_token}`,
      };

      const customerRes = await fetch(`/api/customers/${customerId}`, { headers });
      const customerJson = (await customerRes.json()) as CustomerApiResponse;

      if (!customerRes.ok || !customerJson.ok || !customerJson.customer) {
        setCustomer(null);
        setCommunications([]);
        setMessage(`Customer API error: ${customerJson.error ?? customerRes.status}`);
        return;
      }

      const commRes = await fetch(
        `/api/communications?customerId=${encodeURIComponent(customerId)}&channel=call&direction=inbound&limit=20`,
        { headers }
      );
      const commJson = (await commRes.json()) as CommunicationsApiResponse;

      if (!commRes.ok || !commJson.ok) {
        setCustomer(customerJson.customer);
        setCommunications([]);
        setMessage(`Communications API error: ${commJson.error ?? commRes.status}`);
        return;
      }

      setCustomer(customerJson.customer);
      setCommunications(commJson.communications ?? []);
      setMessage(`Loaded customer and ${commJson.count ?? 0} inbound calls.`);
    } catch (err) {
      setCustomer(null);
      setCommunications([]);
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
            Customer detail
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Reads one customer from /api/customers/[id] and calls from /api/communications.
          </p>
        </div>
        <Link href="/communications/backend" className="text-sm font-semibold text-zinc-500 hover:text-zinc-900">
          Back to calls
        </Link>
      </div>

      <button
        type="button"
        onClick={loadCustomer}
        disabled={loading}
        className="rounded-2xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Loading...' : 'Load customer'}
      </button>

      <p className="text-sm text-zinc-500">{message}</p>

      {customer ? (
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-zinc-900">{customerTitle(customer)}</p>
              <p className="text-sm text-zinc-500">
                {customer.crmNumber ?? 'No CRM number'} | {customer.source ?? 'no source'} | {customer.status}
              </p>
            </div>
            <p className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">
              {customer.preferredContactMethod}
            </p>
          </div>

          <div className="mt-4 grid gap-3 text-sm text-zinc-600 sm:grid-cols-2">
            <p>Phone: {maskPhone(customer.phone)}</p>
            <p>Mobile: {maskPhone(customer.mobilePhone)}</p>
            <p>Landline: {maskPhone(customer.landlinePhone)}</p>
            <p>Email: {customer.email ?? 'No email'}</p>
            <p>Last contact: {formatDate(customer.lastContactAt)}</p>
            <p>Created: {formatDate(customer.createdAt)}</p>
          </div>

          {customer.notes ? (
            <p className="mt-4 rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-500">{customer.notes}</p>
          ) : null}
        </section>
      ) : null}

      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <p className="text-sm font-semibold text-zinc-900">Inbound PBX calls</p>
        </div>

        {communications.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            No calls loaded.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {communications.map((item) => (
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
                  {item.channel} | {item.direction} | {item.status}
                </p>
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
