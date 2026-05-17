'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { loadState, saveState, addCustomer, ensureCustomerCrmNumbers, getNextCrmNumber, mergeCustomers } from '@/lib/storage';
import { demoCustomers } from '@/lib/demo-data';
import type { Customer, CustomerStatus, CustomerSource } from '@/lib/types';
import { norm } from '@/lib/search';
import CustomerCard from '@/components/customers/CustomerCard';
import CustomerForm from '@/components/customers/CustomerForm';
import DuplicateCustomersPanel from '@/components/customers/DuplicateCustomersPanel';
import CustomerDataQualityPanel, { isIncompleteCustomer } from '@/components/customers/CustomerDataQualityPanel';
import { STATUS_LABELS } from '@/components/customers/CustomerStatusBadge';
import { SOURCE_LABELS } from '@/components/customers/CustomerCard';

const selCls =
  'rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-700 outline-none focus:border-indigo-400';

export default function CustomersPage() {
  // Start with [] so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | ''>('');
  const [sourceFilter, setSourceFilter] = useState<CustomerSource | ''>('');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Load localStorage after mount to avoid hydration mismatch.
  // Preserves seeding rule: undefined = seed demo, [] = user cleared intentionally.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
  useEffect(() => {
    const state = loadState();
    let nextCustomers: Customer[];
    if (state.customers === undefined) {
      nextCustomers = demoCustomers;
    } else {
      nextCustomers = state.customers;
    }
    // Assign CRM numbers to any customer that is missing one (migration + demo seed).
    const numbered = ensureCustomerCrmNumbers(nextCustomers);
    const needsSave =
      state.customers === undefined ||
      numbered.some((c, i) => c.crmNumber !== nextCustomers[i].crmNumber);
    if (needsSave) {
      saveState({ customers: numbered });
    }
    const timer = window.setTimeout(() => {
      setCustomers(numbered);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const hasFilter = search.trim() !== '' || statusFilter !== '' || sourceFilter !== '' || incompleteOnly;

  const filtered = useMemo(() => {
    const q = norm(search.trim());
    return customers.filter((c) => {
      if (q) {
        const hit =
          norm(c.name).includes(q) ||
          norm(c.companyName).includes(q) ||
          norm(c.phone).includes(q) ||
          norm(c.email).includes(q) ||
          norm(c.notes).includes(q) ||
          norm(c.needsSummary).includes(q) ||
          norm(c.crmNumber ?? '').includes(q) ||
          norm(c.mobilePhone ?? '').includes(q) ||
          norm(c.landlinePhone ?? '').includes(q);
        if (!hit) return false;
      }
      if (statusFilter && c.status !== statusFilter) return false;
      if (sourceFilter && c.source !== sourceFilter) return false;
      if (incompleteOnly && !isIncompleteCustomer(c)) return false;
      return true;
    });
  }, [customers, search, statusFilter, sourceFilter, incompleteOnly]);

  function clearFilters() {
    setSearch('');
    setStatusFilter('');
    setSourceFilter('');
    setIncompleteOnly(false);
  }

  function handleMergeCustomers(primaryId: string, duplicateId: string) {
    mergeCustomers(primaryId, duplicateId);
    const freshCustomers = ensureCustomerCrmNumbers(loadState().customers ?? []);
    setCustomers(freshCustomers);
  }

  function handleCreate(customer: Customer) {
    const crmNumber = customer.crmNumber ?? getNextCrmNumber(customers);
    const withCrm = { ...customer, crmNumber };
    addCustomer(withCrm);
    setCustomers((prev) => [...prev, withCrm]);
    setShowForm(false);
  }

  // Stable loading shell — identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-zinc-900">Πελάτες</h1>
          <button
            type="button"
            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
          >
            + Νέος πελάτης
          </button>
        </div>
        <div className="mb-4 space-y-2">
          <input
            type="search"
            disabled
            placeholder="Αναζήτηση ονόματος, εταιρείας, τηλεφώνου, email, σημειώσεων..."
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <select disabled className={selCls}>
              <option>Όλα τα status</option>
            </select>
            <select disabled className={selCls}>
              <option>Όλες οι πηγές</option>
            </select>
          </div>
        </div>
        <p className="py-10 text-center text-sm text-zinc-400">Φόρτωση πελατών...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold text-zinc-900">Πελάτες</h1>
          {customers.length > 0 && (
            <span className="text-sm text-zinc-400">{customers.length}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            showForm
              ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {showForm ? 'Ακύρωση' : '+ Νέος πελάτης'}
        </button>
      </div>

      {/* New customer form */}
      {showForm && (
        <div className="mb-5">
          <CustomerForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Duplicate detection panel */}
      <DuplicateCustomersPanel customers={customers} onMerge={handleMergeCustomers} />

      {/* Data quality panel */}
      <CustomerDataQualityPanel customers={customers} />

      {/* Search + filters */}
      <div className="mb-4 space-y-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Αναζήτηση ονόματος, εταιρείας, τηλεφώνου, email, σημειώσεων..."
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CustomerStatus | '')}
            className={selCls}
          >
            <option value="">Όλα τα status</option>
            {(Object.entries(STATUS_LABELS) as [CustomerStatus, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value as CustomerSource | '')}
            className={selCls}
          >
            <option value="">Όλες οι πηγές</option>
            {(Object.entries(SOURCE_LABELS) as [CustomerSource, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setIncompleteOnly((v) => !v)}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
              incompleteOnly
                ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            Ελλιπείς
          </button>
          {hasFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Καθαρισμός
            </button>
          )}
        </div>
      </div>

      {/* Customer list */}
      {customers.length === 0 ? (
        <div className="rounded-2xl bg-zinc-50 px-5 py-8 text-center ring-1 ring-zinc-100 space-y-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">Δεν έχεις πελάτες ακόμα.</p>
            <p className="mt-1 text-sm text-zinc-400">
              Πρόσθεσε έναν πελάτη ή φόρτωσε demo δεδομένα για να δοκιμάσεις.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              + Νέος πελάτης
            </button>
            <Link
              href="/settings"
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
            >
              Φόρτωση demo δεδομένων
            </Link>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-zinc-50 px-5 py-8 text-center ring-1 ring-zinc-100">
          <p className="text-sm font-medium text-zinc-500">Δεν βρέθηκαν αποτελέσματα.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Δοκίμασε διαφορετικούς όρους ή κάνε καθαρισμό φίλτρων.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((customer) => (
            <li key={customer.id}>
              <CustomerCard customer={customer} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
