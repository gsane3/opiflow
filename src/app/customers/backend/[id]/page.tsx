'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

interface CustomerDto {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  status: string;
  needsSummary: string | null;
  notes: string | null;
  preferredContactMethod: string;
  intakeStatus: string;
  lastContactAt: string | null;
  createdAt: string;
  updatedAt: string;
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

interface TaskDto {
  id: string;
  customerId: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  dueTime: string | null;
  note: string | null;
  createdFromAi: boolean;
  sourceBriefId?: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Label maps
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  website_form: 'Φόρμα ιστοσελίδας',
  referral: 'Σύσταση',
  inbound_call: 'Εισερχόμενη κλήση',
  missed_call: 'Χαμένη κλήση',
  manual_entry: 'Χειροκίνητη εισαγωγή',
  other: 'Άλλο',
};

const STATUS_LABELS: Record<string, string> = {
  new_lead: 'Νέος',
  contacted: 'Επικοινωνία',
  follow_up_needed: 'Follow-up',
  offer_drafted: 'Προσφορά (draft)',
  offer_sent: 'Προσφορά εστάλη',
  won: 'Κερδήθηκε',
  lost: 'Χάθηκε',
};

const INTAKE_LABELS: Record<string, string> = {
  none: '',
  pending: 'Εκκρεμεί',
  sent: 'Viber εστάλη',
  opened: 'Άνοιξε link',
  submitted: 'Υπέβαλε στοιχεία',
  completed: 'Ολοκληρώθηκε',
  expired: 'Έληξε',
  revoked: 'Ανακλήθηκε',
};

const CONTACT_LABELS: Record<string, string> = {
  phone: 'Τηλέφωνο',
  email: 'Email',
  viber: 'Viber',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  call_back: 'Κλήση',
  send_offer: 'Αποστολή προσφοράς',
  follow_up_offer: 'Follow-up προσφοράς',
  ask_for_photos_documents: 'Έγγραφα/φωτογραφίες',
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη',
  wait_for_reply: 'Αναμονή απάντησης',
  other: 'Άλλο',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  ai_draft: 'AI draft',
  open: 'Ανοιχτό',
  completed: 'Ολοκληρωμένο',
  cancelled: 'Ακυρωμένο',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'Υψηλή',
  normal: 'Κανονική',
  low: 'Χαμηλή',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function customerTitle(c: CustomerDto): string {
  return c.name ?? c.companyName ?? c.crmNumber ?? 'Νέος πελάτης';
}

function formatDateFull(value: string | null): string {
  if (!value) return 'Άγνωστη ημερομηνία';
  try {
    return new Date(value).toLocaleString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatDateShort(value: string | null): string {
  if (!value) return '';
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '...';
}

function statusBadgeClass(status: string): string {
  if (status === 'won') return 'bg-green-100 text-green-700';
  if (status === 'lost') return 'bg-red-100 text-red-600';
  if (status === 'new_lead') return 'bg-blue-50 text-blue-700';
  return 'bg-indigo-50 text-indigo-700';
}

function taskStatusClass(status: string): string {
  if (status === 'ai_draft') return 'bg-amber-100 text-amber-700';
  if (status === 'completed') return 'bg-green-100 text-green-700';
  if (status === 'cancelled') return 'bg-zinc-100 text-zinc-500';
  return 'bg-indigo-50 text-indigo-700';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type PageState = 'loading' | 'no_session' | 'error' | 'loaded';

type TimelineItem =
  | { kind: 'comm'; item: CommunicationDto; date: string }
  | { kind: 'task'; item: TaskDto; date: string };

export default function BackendCustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const customerId = params.id;

  const [pageState, setPageState] = useState<PageState>('loading');
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [communications, setCommunications] = useState<CommunicationDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setPageState('loading');

      let supabase: ReturnType<typeof createBrowserSupabaseClient>;
      try {
        supabase = createBrowserSupabaseClient();
      } catch {
        if (!cancelled) setPageState('error');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) setPageState('no_session');
        return;
      }

      const headers = { Authorization: `Bearer ${session.access_token}` };

      try {
        const [customerRes, commRes, tasksRes] = await Promise.all([
          fetch(`/api/customers/${customerId}`, { headers }),
          fetch(`/api/communications?customerId=${encodeURIComponent(customerId)}&limit=50`, { headers }),
          fetch(`/api/tasks?customerId=${encodeURIComponent(customerId)}&limit=50`, { headers }),
        ]);

        const customerJson = await customerRes.json() as {
          ok?: boolean; customer?: CustomerDto; error?: string;
        };
        const commJson = await commRes.json() as {
          ok?: boolean; communications?: CommunicationDto[]; error?: string;
        };
        const tasksJson = await tasksRes.json() as {
          ok?: boolean; tasks?: TaskDto[]; error?: string;
        };

        if (cancelled) return;

        if (!customerJson.ok || !customerJson.customer) {
          setPageState('error');
          return;
        }

        setCustomer(customerJson.customer);
        setCommunications(commJson.ok ? (commJson.communications ?? []) : []);
        setTasks(tasksJson.ok ? (tasksJson.tasks ?? []) : []);
        setPageState('loaded');
      } catch {
        if (!cancelled) setPageState('error');
      }
    }

    load();
    return () => { cancelled = true; };
  }, [customerId, refreshTick]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const aiBriefComm = useMemo(
    () => communications.find(c => c.summary?.startsWith('AI brief')) ?? null,
    [communications]
  );

  const draftTask = useMemo(
    () => tasks.find(t => t.status === 'ai_draft') ?? null,
    [tasks]
  );

  const openTasks = useMemo(
    () => tasks.filter(t => t.status === 'open'),
    [tasks]
  );

  const callComms = useMemo(
    () =>
      [...communications]
        .filter(c => c.channel === 'call')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [communications]
  );

  const timeline = useMemo((): TimelineItem[] => {
    const items: TimelineItem[] = [
      ...communications.map(c => ({ kind: 'comm' as const, item: c, date: c.createdAt })),
      ...tasks.map(t => ({ kind: 'task' as const, item: t, date: t.createdAt })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [communications, tasks]);

  const sortedTasks = useMemo(() =>
    [...tasks].sort((a, b) => {
      if (a.status === 'ai_draft' && b.status !== 'ai_draft') return -1;
      if (b.status === 'ai_draft' && a.status !== 'ai_draft') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    }),
    [tasks]
  );

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  if (pageState === 'loading') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-center text-sm text-zinc-400">Φόρτωση καρτέλας πελάτη...</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // No session
  // ---------------------------------------------------------------------------
  if (pageState === 'no_session') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl bg-zinc-50 px-6 py-10 text-center ring-1 ring-zinc-100">
          <p className="text-sm font-medium text-zinc-600">
            Συνδέσου για να δεις την καρτέλα πελάτη.
          </p>
          <Link
            href="/login/backend"
            className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error
  // ---------------------------------------------------------------------------
  if (pageState === 'error' || !customer) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl bg-red-50 px-6 py-8 text-center ring-1 ring-red-100">
          <p className="text-sm font-medium text-red-700">
            Αδυναμία φόρτωσης καρτέλας. Έλεγξε τη σύνδεση ή ανανέωσε.
          </p>
          <button
            type="button"
            onClick={() => setRefreshTick(t => t + 1)}
            className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50"
          >
            Δοκίμασε ξανά
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Loaded: full CRM detail
  // ---------------------------------------------------------------------------
  const intakeLabel = INTAKE_LABELS[customer.intakeStatus] ?? '';

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-5">

      {/* Back nav */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/customers/backend"
          className="font-medium text-zinc-400 transition hover:text-zinc-700"
        >
          Πελάτες
        </Link>
        <span className="text-zinc-300">/</span>
        <span className="text-zinc-500">{customer.crmNumber ?? customerTitle(customer)}</span>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-zinc-900 leading-tight">
            {customerTitle(customer)}
          </h1>
          <button
            type="button"
            onClick={() => setRefreshTick(t => t + 1)}
            className="shrink-0 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
          >
            Ανανέωση
          </button>
        </div>
        {customer.companyName && customer.name && (
          <p className="mt-0.5 text-sm text-zinc-500">{customer.companyName}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {customer.source && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600">
              {SOURCE_LABELS[customer.source] ?? customer.source}
            </span>
          )}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(customer.status)}`}>
            {STATUS_LABELS[customer.status] ?? customer.status}
          </span>
          {intakeLabel && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              customer.intakeStatus === 'submitted' || customer.intakeStatus === 'completed'
                ? 'bg-green-50 text-green-700'
                : 'bg-amber-50 text-amber-700'
            }`}>
              {intakeLabel}
            </span>
          )}
          {customer.preferredContactMethod && (
            <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500">
              {CONTACT_LABELS[customer.preferredContactMethod] ?? customer.preferredContactMethod}
            </span>
          )}
        </div>
      </div>

      {/* Top summary grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

        {/* Customer info card */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Στοιχεία επικοινωνίας
          </h2>
          <dl className="space-y-2 text-sm">
            {customer.phone && (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-400">Τηλέφωνο</dt>
                <dd className="font-medium text-zinc-800">{customer.phone}</dd>
              </div>
            )}
            {customer.mobilePhone && (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-400">Κινητό</dt>
                <dd className="font-medium text-zinc-800">{customer.mobilePhone}</dd>
              </div>
            )}
            {customer.landlinePhone && (
              <div className="flex justify-between gap-2">
                <dt className="text-zinc-400">Σταθερό</dt>
                <dd className="font-medium text-zinc-800">{customer.landlinePhone}</dd>
              </div>
            )}
            {customer.email && (
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 text-zinc-400">Email</dt>
                <dd className="break-all font-medium text-zinc-800">{customer.email}</dd>
              </div>
            )}
            {customer.address && (
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 text-zinc-400">Διεύθυνση</dt>
                <dd className="text-zinc-700">{customer.address}</dd>
              </div>
            )}
            {customer.lastContactAt && (
              <div className="flex justify-between gap-2 border-t border-zinc-50 pt-2">
                <dt className="text-zinc-400">Τελευταία επαφή</dt>
                <dd className="text-zinc-600">{formatDateShort(customer.lastContactAt)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-zinc-400">Δημιουργία</dt>
              <dd className="text-zinc-500">{formatDateFull(customer.createdAt)}</dd>
            </div>
          </dl>
        </section>

        {/* AI brief card */}
        <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            AI Brief
          </h2>
          {aiBriefComm?.summary ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
              {aiBriefComm.summary}
            </p>
          ) : (
            <p className="text-sm text-zinc-400">
              Δεν υπάρχει ακόμα AI brief από κλήση.
            </p>
          )}
        </section>
      </div>

      {/* Draft task / next action card */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Επόμενη ενέργεια
        </h2>
        {draftTask ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                Draft task από AI
              </span>
              <span className="text-xs text-zinc-400">
                {TASK_TYPE_LABELS[draftTask.type] ?? draftTask.type}
              </span>
              <span className="text-xs text-zinc-400">{draftTask.dueDate}</span>
            </div>
            <p className="font-medium text-zinc-800">{draftTask.title}</p>
            {draftTask.note && (
              <p className="text-sm text-zinc-500">{truncate(draftTask.note, 200)}</p>
            )}
          </div>
        ) : openTasks.length > 0 ? (
          <div className="space-y-2">
            {openTasks.slice(0, 2).map(t => (
              <div key={t.id} className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-zinc-700">{t.title}</p>
                <span className="shrink-0 text-xs text-zinc-400">{t.dueDate}</span>
              </div>
            ))}
            {openTasks.length > 2 && (
              <p className="text-xs text-zinc-400">+{openTasks.length - 2} ακόμα...</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν εκκρεμείς ενέργειες.</p>
        )}
      </section>

      {/* A. Timeline */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Ιστορικό</h2>
        </div>
        {timeline.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχει ιστορικό ακόμα.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {timeline.map(entry =>
              entry.kind === 'comm' ? (
                <li key={`c-${entry.item.id}`} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-indigo-600">
                      {entry.item.channel === 'call' ? 'Κλήση' : entry.item.channel}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {formatDateShort(entry.item.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    {entry.item.direction === 'inbound' ? 'Εισερχόμενη' : 'Εξερχόμενη'} · {entry.item.status}
                  </p>
                  {entry.item.summary?.startsWith('AI brief') && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-500">
                      {truncate(entry.item.summary, 180)}
                    </p>
                  )}
                </li>
              ) : (
                <li key={`t-${entry.item.id}`} className="space-y-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-zinc-500">Task</span>
                    <span className="shrink-0 text-xs text-zinc-400">
                      {formatDateShort(entry.item.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-zinc-700">{entry.item.title}</p>
                  <p className="text-xs text-zinc-400">
                    {TASK_STATUS_LABELS[entry.item.status] ?? entry.item.status}
                    {' · '}
                    {TASK_TYPE_LABELS[entry.item.type] ?? entry.item.type}
                    {' · '}
                    {entry.item.dueDate}
                  </p>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      {/* B. Calls */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Κλήσεις</h2>
        </div>
        {callComms.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν καταγεγραμμένες κλήσεις ακόμα.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {callComms.map(c => (
              <li key={c.id} className="space-y-1 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-zinc-700">
                    {c.direction === 'inbound' ? 'Εισερχόμενη κλήση' : 'Εξερχόμενη κλήση'}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {formatDateShort(c.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">{c.status}</p>
                {c.summary?.startsWith('AI brief') && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">
                    {c.summary}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* C. Tasks */}
      <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">Tasks</h2>
        </div>
        {sortedTasks.length === 0 ? (
          <p className="px-4 py-5 text-sm text-zinc-400">
            Δεν υπάρχουν tasks ακόμα.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {sortedTasks.map(t => (
              <li key={t.id} className="space-y-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${taskStatusClass(t.status)}`}>
                    {TASK_STATUS_LABELS[t.status] ?? t.status}
                  </span>
                  {t.createdFromAi && (
                    <span className="text-xs text-zinc-400">από AI</span>
                  )}
                  <span className="text-xs text-zinc-400">
                    {PRIORITY_LABELS[t.priority] ?? t.priority}
                  </span>
                </div>
                <p className="font-medium text-zinc-800">{t.title}</p>
                <p className="text-xs text-zinc-400">
                  {TASK_TYPE_LABELS[t.type] ?? t.type} · {t.dueDate}
                  {t.dueTime ? ` ${t.dueTime}` : ''}
                </p>
                {t.note && (
                  <p className="text-sm text-zinc-500">{truncate(t.note, 160)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* D. Notes */}
      <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Σημειώσεις
        </h2>
        {customer.notes ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
            {customer.notes}
          </p>
        ) : (
          <p className="text-sm text-zinc-400">Δεν υπάρχουν σημειώσεις ακόμα.</p>
        )}
      </section>

      {/* E. Files placeholder */}
      <section className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-100">
        <h2 className="text-sm font-semibold text-zinc-700">Αρχεία και έγγραφα</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Εδώ θα εμφανίζονται φωτογραφίες, έγγραφα και αρχεία προσφοράς.
        </p>
      </section>

    </div>
  );
}
