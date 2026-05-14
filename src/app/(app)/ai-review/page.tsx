'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { loadState, addCustomer, updateCustomer, addTask, addOffer } from '@/lib/storage';
import { generateDemoAiResult } from '@/lib/demo-data';
import { calculateTotals, fmtEur } from '@/lib/offer-calculations';
import type {
  CustomerStatus,
  CustomerSource,
  TaskType,
  TaskPriority,
  PreferredContactMethod,
  Customer,
  Task,
  Offer,
} from '@/lib/types';
import type { AiReviewResult } from '@/lib/ai/schema';
import { STATUS_LABELS } from '@/components/customers/CustomerStatusBadge';
import { SOURCE_LABELS } from '@/components/customers/CustomerCard';
import { TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from '@/components/tasks/TaskStatusBadge';
import AiWarningBadge from '@/components/ai/AiWarningBadge';

type EditableTask = {
  _id: string;
  title: string;
  type: TaskType;
  dueDate: string;
  dueTime: string;
  priority: TaskPriority;
  note: string;
};

type EditableItem = {
  _id: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

const inputCls =
  'w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const selectCls =
  'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const labelCls = 'mb-1 block text-xs font-medium text-zinc-600';

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function AiReviewPage() {
  const router = useRouter();

  const [init] = useState(generateDemoAiResult);
  const [businessProfile] = useState(() => {
    if (typeof window === 'undefined') return null;
    return loadState().businessProfile ?? null;
  });

  // Customer fields
  const [customerName, setCustomerName] = useState(init.customer.name);
  const [customerPhone, setCustomerPhone] = useState(init.customer.phone);
  const [customerEmail, setCustomerEmail] = useState(init.customer.email);
  const [customerSource, setCustomerSource] = useState<CustomerSource>(init.customer.source);
  const [opportunityValue, setOpportunityValue] = useState(
    init.customer.opportunityValue.toString()
  );
  const [preferredContact, setPreferredContact] = useState<PreferredContactMethod>(
    init.customer.preferredContactMethod
  );

  // AI result fields
  const [summary, setSummary] = useState(init.summary);
  const [customerNeeds, setCustomerNeeds] = useState(init.customerNeeds);
  const [statusUpdate, setStatusUpdate] = useState<CustomerStatus>(init.statusUpdate);
  const [nextBestAction, setNextBestAction] = useState(init.nextBestAction);
  const [warnings, setWarnings] = useState<string[]>(init.warnings);

  // Tasks
  const [tasks, setTasks] = useState<EditableTask[]>(() =>
    init.tasks.map((t) => ({ ...t, _id: crypto.randomUUID() }))
  );

  // Offer
  const [createOffer, setCreateOffer] = useState(init.offer.shouldCreate);
  const [offerItems, setOfferItems] = useState<EditableItem[]>(() =>
    init.offer.items.map((i) => ({ ...i, _id: crypto.randomUUID() }))
  );
  const [offerNotes, setOfferNotes] = useState(init.offer.notes);
  const [offerTerms] = useState(
    init.offer.terms || businessProfile?.defaultOfferTerms || ''
  );

  // AI input state
  const [aiInputText, setAiInputText] = useState('');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [aiError, setAiError] = useState('');
  const [resultSource, setResultSource] = useState<'demo' | 'ai'>('demo');

  // Phase
  const [phase, setPhase] = useState<'review' | 'saved'>('review');
  const [savedCustomerId, setSavedCustomerId] = useState('');
  const [saveError, setSaveError] = useState('');

  const vatRate = businessProfile?.defaultVatRate ?? 24;

  const offerTotals = useMemo(
    () =>
      calculateTotals(
        offerItems
          .filter((i) => i.description.trim())
          .map((i) => ({
            id: i._id,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        vatRate
      ),
    [offerItems, vatRate]
  );

  function updateTask(_id: string, updates: Partial<Omit<EditableTask, '_id'>>) {
    setTasks((prev) => prev.map((t) => (t._id === _id ? { ...t, ...updates } : t)));
  }

  function updateItem(_id: string, updates: Partial<Omit<EditableItem, '_id'>>) {
    setOfferItems((prev) => prev.map((i) => (i._id === _id ? { ...i, ...updates } : i)));
  }

  function applyResult(result: AiReviewResult) {
    setCustomerName(result.customer.name);
    setCustomerPhone(result.customer.phone);
    setCustomerEmail(result.customer.email);
    setCustomerSource(result.customer.source);
    setOpportunityValue(
      result.customer.opportunityValue > 0 ? result.customer.opportunityValue.toString() : ''
    );
    setPreferredContact(result.customer.preferredContactMethod);
    setSummary(result.summary);
    setCustomerNeeds(result.customerNeeds);
    setStatusUpdate(result.statusUpdate);
    setNextBestAction(result.nextBestAction);
    setWarnings(result.warnings);
    setTasks(result.tasks.map((t) => ({ ...t, _id: crypto.randomUUID() })));
    setCreateOffer(result.offer.shouldCreate);
    setOfferItems(result.offer.items.map((i) => ({ ...i, _id: crypto.randomUUID() })));
    setOfferNotes(result.offer.notes);
    // offerTerms intentionally not overwritten — keeps business default
  }

  function handleResetToDemo() {
    applyResult(init);
    setResultSource('demo');
    setAiError('');
  }

  async function handleAiSubmit() {
    const text = aiInputText.trim();
    if (!text) return;
    setIsLoadingAi(true);
    setAiError('');
    try {
      const res = await fetch('/api/ai/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputText: text,
          businessType: businessProfile?.businessType,
          businessName: businessProfile?.businessName,
          defaultVatRate: businessProfile?.defaultVatRate,
        }),
      });
      const data = (await res.json()) as { error?: string; result?: AiReviewResult };
      if (!res.ok || !data.result) {
        const err = data.error ?? 'unknown';
        if (err === 'no_api_key') {
          setAiError('Δεν υπάρχει API key. Χρησιμοποιείται το demo αποτέλεσμα.');
        } else if (err === 'invalid_response') {
          setAiError('Μη έγκυρη απάντηση AI. Χρησιμοποιείται το demo αποτέλεσμα.');
        } else {
          setAiError('Η επεξεργασία AI απέτυχε. Δοκίμασε ξανά ή χρησιμοποίησε το demo.');
        }
        return;
      }
      applyResult(data.result);
      setResultSource('ai');
    } catch {
      setAiError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
    } finally {
      setIsLoadingAi(false);
    }
  }

  function handleSave() {
    if (!customerName.trim()) {
      setSaveError('Το όνομα πελάτη είναι υποχρεωτικό.');
      return;
    }
    setSaveError('');

    const state = loadState();
    const now = new Date().toISOString();
    const todayStr = now.split('T')[0];

    // ── Find or create customer (phone first, then exact normalized name) ──
    const phone = customerPhone.trim();
    const normalizedName = customerName.trim().toLowerCase().replace(/\s+/g, ' ');

    let existing: Customer | undefined;
    if (phone) {
      existing = (state.customers ?? []).find((c) => c.phone === phone);
    }
    if (!existing && normalizedName) {
      existing = (state.customers ?? []).find(
        (c) => c.name.trim().toLowerCase().replace(/\s+/g, ' ') === normalizedName
      );
    }

    let customerId: string;

    if (existing) {
      const updated: Customer = {
        ...existing,
        name: customerName.trim(),
        phone,
        email: customerEmail.trim(),
        source: customerSource,
        opportunityValue: opportunityValue ? Number(opportunityValue) : existing.opportunityValue,
        preferredContactMethod: preferredContact,
        status: statusUpdate,
        needsSummary: summary.trim(),
        notes: customerNeeds.trim(),
        updatedAt: now,
      };
      updateCustomer(updated);
      customerId = existing.id;
    } else {
      const newCustomer: Customer = {
        id: crypto.randomUUID(),
        name: customerName.trim(),
        companyName: '',
        phone,
        email: customerEmail.trim(),
        address: '',
        source: customerSource,
        opportunityValue: opportunityValue ? Number(opportunityValue) : undefined,
        status: statusUpdate,
        preferredContactMethod: preferredContact,
        needsSummary: summary.trim(),
        notes: customerNeeds.trim(),
        createdAt: now,
        updatedAt: now,
      };
      addCustomer(newCustomer);
      customerId = newCustomer.id;
    }

    // ── Create tasks ──
    for (const t of tasks) {
      if (!t.title.trim()) continue;
      const task: Task = {
        id: crypto.randomUUID(),
        customerId,
        title: t.title.trim(),
        type: t.type,
        status: 'open',
        priority: t.priority,
        dueDate: t.dueDate || todayStr,
        dueTime: t.dueTime || undefined,
        note: t.note.trim(),
        createdFromAi: true,
        createdAt: now,
        updatedAt: now,
      };
      addTask(task);
    }

    // ── Create offer if toggled on ──
    if (createOffer) {
      const validItems = offerItems.filter(
        (i) => i.description.trim() && i.unitPrice > 0
      );
      if (validItems.length > 0) {
        const freshState = loadState();
        const existing = freshState.offers ?? [];
        const maxNum =
          existing.length === 0
            ? 0
            : Math.max(
                ...existing.map((o) => {
                  const match = o.offerNumber.match(/(\d+)$/);
                  return match ? parseInt(match[1]) : 0;
                })
              );
        const offerNumber = `#${String(maxNum + 1).padStart(3, '0')}`;
        const in30days = new Date();
        in30days.setDate(in30days.getDate() + 30);

        const { subtotal, vatAmount, total } = calculateTotals(
          validItems.map((i) => ({
            id: i._id,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          vatRate
        );

        const offer: Offer = {
          id: crypto.randomUUID(),
          customerId,
          offerNumber,
          status: 'draft',
          offerDate: todayStr,
          validUntil: in30days.toISOString().split('T')[0],
          items: validItems.map((i) => ({
            id: i._id,
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
          subtotal,
          vatRate,
          vatAmount,
          total,
          notes: offerNotes.trim(),
          terms: offerTerms || freshState.businessProfile?.defaultOfferTerms || '',
          acceptanceText:
            freshState.businessProfile?.defaultAcceptanceText ??
            'Αποδέχομαι τους παραπάνω όρους.',
          createdFromAi: true,
          createdAt: now,
          updatedAt: now,
        };
        addOffer(offer);
      }
    }

    setSavedCustomerId(customerId);
    setPhase('saved');
  }

  // ── Success screen ────────────────────────────────────────────────────────
  if (phase === 'saved') {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center space-y-5">
        <div className="flex justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <svg
              className="h-7 w-7 text-green-600"
              fill="none"
              strokeWidth={2.5}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
        </div>
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Αποθηκεύτηκε στο CRM</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Η περίληψη, τα tasks και οι αλλαγές αποθηκεύτηκαν τοπικά στον browser.
            Δεν στάλθηκαν σε κανέναν.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {savedCustomerId && (
            <Link
              href={`/customers/${savedCustomerId}`}
              className="flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              Άνοιγμα πελάτη
            </Link>
          )}
          <Link
            href="/tasks"
            className="flex items-center justify-center rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            Δες τα tasks
          </Link>
          <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-zinc-700">
            Πίσω στην αρχική
          </Link>
        </div>
      </div>
    );
  }

  // ── Review screen ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-2xl px-4 pt-5 pb-10 space-y-4">
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <h1 className="text-lg font-semibold text-zinc-900">Έλεγξε πριν αποθηκευτεί</h1>
          {resultSource === 'ai' ? (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
              AI αποτέλεσμα
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">
              Demo αποτέλεσμα
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          Το yorgos.ai ετοίμασε τα παρακάτω. Μπορείς να τα διορθώσεις πριν αποθηκευτούν στο CRM.
        </p>
      </div>

      {/* AI input */}
      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Επεξεργασία με AI
        </p>
        <textarea
          value={aiInputText}
          onChange={(e) => setAiInputText(e.target.value)}
          placeholder='π.χ. "Ο Παπαδόπουλος θέλει HVAC 120τμ, ζήτησε προσφορά εργασίας και υλικών"'
          rows={2}
          className={`${inputCls} resize-none`}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { void handleAiSubmit(); }}
            disabled={isLoadingAi || !aiInputText.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoadingAi ? 'Επεξεργασία...' : 'Δημιούργησε με AI'}
          </button>
          {resultSource === 'ai' && (
            <button
              type="button"
              onClick={handleResetToDemo}
              className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              Επαναφορά Demo
            </button>
          )}
        </div>
        {aiError && (
          <p className="mt-2 text-xs text-red-600">{aiError}</p>
        )}
        {resultSource === 'demo' && !aiError && (
          <p className="mt-2 text-xs text-zinc-400">
            Χωρίς API key τρέχει σε demo λειτουργία.
          </p>
        )}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <AiWarningBadge key={i} message={w} />
          ))}
        </div>
      )}

      {/* Customer */}
      <SectionCard title="Πελάτης">
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Όνομα *</label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className={labelCls}>Τηλέφωνο</label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="flex-1">
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1 basis-40">
              <label className={labelCls}>Πηγή</label>
              <select
                value={customerSource}
                onChange={(e) => setCustomerSource(e.target.value as CustomerSource)}
                className={selectCls}
              >
                {(Object.entries(SOURCE_LABELS) as [CustomerSource, string][]).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28 shrink-0">
              <label className={labelCls}>Εκτιμ. αξία (€)</label>
              <input
                type="number"
                min={0}
                value={opportunityValue}
                onChange={(e) => setOpportunityValue(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Summary */}
      <SectionCard title="Περίληψη">
        <textarea
          rows={3}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className={`${inputCls} resize-none`}
        />
      </SectionCard>

      {/* Customer needs */}
      <SectionCard title="Ανάγκες πελάτη">
        <textarea
          rows={2}
          value={customerNeeds}
          onChange={(e) => setCustomerNeeds(e.target.value)}
          className={`${inputCls} resize-none`}
        />
      </SectionCard>

      {/* Tasks */}
      <SectionCard title={`Tasks (${tasks.length})`}>
        {tasks.length === 0 ? (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν προτεινόμενα tasks.</p>
        ) : (
          <div className="space-y-3">
            {tasks.map((task, idx) => (
              <div key={task._id} className="rounded-xl border border-zinc-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">Task {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => setTasks((prev) => prev.filter((t) => t._id !== task._id))}
                    className="text-xs text-zinc-400 hover:text-red-500"
                  >
                    Αφαίρεση
                  </button>
                </div>
                <input
                  type="text"
                  value={task.title}
                  onChange={(e) => updateTask(task._id, { title: e.target.value })}
                  placeholder="Τίτλος task"
                  className={inputCls}
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    value={task.type}
                    onChange={(e) => updateTask(task._id, { type: e.target.value as TaskType })}
                    className={`min-w-0 flex-1 ${selectCls}`}
                  >
                    {(Object.entries(TASK_TYPE_LABELS) as [TaskType, string][]).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <select
                    value={task.priority}
                    onChange={(e) =>
                      updateTask(task._id, { priority: e.target.value as TaskPriority })
                    }
                    className={`w-32 ${selectCls}`}
                  >
                    {(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(
                      ([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <input
                  type="date"
                  value={task.dueDate}
                  onChange={(e) => updateTask(task._id, { dueDate: e.target.value })}
                  className={inputCls}
                />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Offer */}
      <SectionCard title="Προσφορά">
        <div className="flex items-center gap-3 mb-3">
          <input
            type="checkbox"
            id="create-offer"
            checked={createOffer}
            onChange={(e) => setCreateOffer(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 accent-indigo-600"
          />
          <label htmlFor="create-offer" className="text-sm font-medium text-zinc-700">
            Δημιουργία προσφοράς
          </label>
        </div>

        {createOffer && (
          <div className="space-y-3">
            {offerItems.map((item) => (
              <div key={item._id} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.description}
                  onChange={(e) => updateItem(item._id, { description: e.target.value })}
                  placeholder="Περιγραφή"
                  className={`min-w-0 flex-1 ${inputCls}`}
                />
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={item.unitPrice}
                  onChange={(e) => updateItem(item._id, { unitPrice: Number(e.target.value) })}
                  placeholder="€"
                  className={`w-20 shrink-0 ${inputCls}`}
                />
                <button
                  type="button"
                  onClick={() => setOfferItems((prev) => prev.filter((i) => i._id !== item._id))}
                  className="shrink-0 text-lg text-zinc-400 hover:text-red-500 leading-none"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setOfferItems((prev) => [
                  ...prev,
                  { _id: crypto.randomUUID(), description: '', quantity: 1, unitPrice: 0 },
                ])
              }
              className="text-sm text-indigo-600 hover:text-indigo-700"
            >
              + Προσθήκη υπηρεσίας
            </button>

            <div className="rounded-xl bg-zinc-50 p-3 text-sm space-y-1">
              <div className="flex justify-between text-zinc-500">
                <span>Καθαρή αξία</span>
                <span>{fmtEur(offerTotals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>ΦΠΑ {vatRate}%</span>
                <span>{fmtEur(offerTotals.vatAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-zinc-200 pt-1 font-semibold text-zinc-900">
                <span>Σύνολο</span>
                <span>{fmtEur(offerTotals.total)}</span>
              </div>
            </div>

            <div>
              <label className={labelCls}>Σημειώσεις</label>
              <textarea
                rows={2}
                value={offerNotes}
                onChange={(e) => setOfferNotes(e.target.value)}
                className={`${inputCls} resize-none`}
              />
            </div>
          </div>
        )}
      </SectionCard>

      {/* Status update */}
      <SectionCard title="Status πελάτη">
        <select
          value={statusUpdate}
          onChange={(e) => setStatusUpdate(e.target.value as CustomerStatus)}
          className={selectCls}
        >
          {(Object.entries(STATUS_LABELS) as [CustomerStatus, string][]).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </SectionCard>

      {/* Next best action */}
      <SectionCard title="Προτεινόμενη επόμενη ενέργεια">
        <p className="text-sm italic text-zinc-600">{nextBestAction || '—'}</p>
      </SectionCard>

      {/* Error */}
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      {/* Action buttons */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="flex-1 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
        >
          Ακύρωση
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Αποθήκευση στο CRM
        </button>
      </div>
    </div>
  );
}
