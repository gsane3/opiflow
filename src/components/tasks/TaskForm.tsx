'use client';

import { useState, useRef, useMemo } from 'react';
import type { Task, TaskType, TaskPriority, Customer } from '@/lib/types';
import { TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from './TaskStatusBadge';
import { norm } from '@/lib/search';

interface Props {
  initial?: Task;
  customers: Customer[];
  onSave: (task: Task) => void;
  onCancel: () => void;
}

const todayStr = () => new Date().toISOString().split('T')[0];

export default function TaskForm({ initial, customers, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [type, setType] = useState<TaskType>(initial?.type ?? 'call_back');
  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? todayStr());
  const [dueTime, setDueTime] = useState(initial?.dueTime ?? '');
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'normal');
  const [note, setNote] = useState(initial?.note ?? '');
  const [error, setError] = useState('');

  // Searchable customer picker state.
  const [customerQuery, setCustomerQuery] = useState(() => {
    if (!initial?.customerId) return '';
    return customers.find((c) => c.id === initial.customerId)?.name ?? '';
  });
  const [showDropdown, setShowDropdown] = useState(false);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredCustomers = useMemo(() => {
    const q = norm(customerQuery.trim());
    if (!q) return customers.slice(0, 10);
    return customers
      .filter(
        (c) =>
          norm(c.name).includes(q) ||
          norm(c.companyName ?? '').includes(q) ||
          norm(c.phone).includes(q) ||
          norm(c.email).includes(q)
      )
      .slice(0, 10);
  }, [customers, customerQuery]);

  function selectCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerQuery(c.name);
    setShowDropdown(false);
  }

  function clearCustomer() {
    setCustomerId('');
    setCustomerQuery('');
    setShowDropdown(false);
    customerInputRef.current?.focus();
  }

  function handleSave() {
    if (!title.trim()) {
      setError('Ο τίτλος είναι υποχρεωτικός.');
      return;
    }
    if (!dueDate) {
      setError('Η ημερομηνία είναι υποχρεωτική.');
      return;
    }
    const now = new Date().toISOString();
    const task: Task = {
      id: initial?.id ?? crypto.randomUUID(),
      customerId: customerId || undefined,
      title: title.trim(),
      type,
      status: initial?.status ?? 'open',
      priority,
      dueDate,
      dueTime: dueTime || undefined,
      note: note.trim(),
      offerId: initial?.offerId,
      createdFromAi: initial?.createdFromAi ?? false,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      completedAt: initial?.completedAt,
      isDemo: initial?.isDemo,
    };
    onSave(task);
  }

  const inputCls =
    'w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
  const selectCls =
    'w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 bg-white';
  const labelCls = 'mb-1 block text-sm font-medium text-zinc-700';

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-100">
      <h3 className="mb-4 text-base font-semibold text-zinc-900">
        {initial ? 'Επεξεργασία εργασίας' : 'Νέα εργασία'}
      </h3>

      <div className="flex flex-col gap-4">
        <div>
          <label className={labelCls}>Τίτλος *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setError(''); }}
            placeholder="π.χ. Κλήση πίσω στον Παπαδόπουλο"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Τύπος</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TaskType)}
            className={selectCls}
          >
            {(Object.entries(TASK_TYPE_LABELS) as [TaskType, string][]).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>

        {/* Searchable customer picker */}
        <div>
          <label className={labelCls}>
            Πελάτης{' '}
            <span className="text-xs font-normal text-zinc-500">(προαιρετικό)</span>
          </label>
          <div className="relative">
            <input
              ref={customerInputRef}
              type="text"
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                setCustomerId('');
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={(e) => {
                if (!dropdownRef.current?.contains(e.relatedTarget as Node)) {
                  setShowDropdown(false);
                  if (!customerId) setCustomerQuery('');
                }
              }}
              placeholder="Αναζήτηση πελάτη..."
              autoComplete="off"
              className={inputCls + ' pr-8'}
            />
            {customerQuery && (
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); clearCustomer(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                tabIndex={-1}
              >
                ✕
              </button>
            )}
            {showDropdown && (
              <div
                ref={dropdownRef}
                className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-md"
              >
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); clearCustomer(); }}
                  className="w-full px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-50"
                >
                  — Χωρίς πελάτη —
                </button>
                {filteredCustomers.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-zinc-400">Δεν βρέθηκαν αποτελέσματα.</p>
                ) : (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                      className={`w-full px-3 py-2 text-left text-sm transition hover:bg-indigo-50 ${
                        c.id === customerId
                          ? 'bg-indigo-50 font-medium text-indigo-700'
                          : 'text-zinc-800'
                      }`}
                    >
                      <span className="block truncate">{c.name}</span>
                      {c.companyName && (
                        <span className="block truncate text-xs text-zinc-400">{c.companyName}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls}>Ημερομηνία *</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => { setDueDate(e.target.value); setError(''); }}
              className={inputCls}
            />
          </div>
          <div className="w-32">
            <label className={labelCls}>
              Ώρα{' '}
              <span className="text-xs font-normal text-zinc-500">(προαιρετικό)</span>
            </label>
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Προτεραιότητα</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className={selectCls}
          >
            {(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(
              ([val, label]) => (
                <option key={val} value={val}>{label}</option>
              )
            )}
          </select>
        </div>

        <div>
          <label className={labelCls}>
            Σημείωση{' '}
            <span className="text-xs font-normal text-zinc-500">(προαιρετικό)</span>
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Σχόλια ή λεπτομέρειες..."
            className={`${inputCls} resize-none`}
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            Ακύρωση
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Αποθήκευση
          </button>
        </div>
      </div>
    </div>
  );
}
