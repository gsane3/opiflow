'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Task, Customer, TaskBaseStatus, TaskType, TaskPriority } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import { norm } from '@/lib/search';
import TaskCard from '@/components/tasks/TaskCard';
import TaskForm from '@/components/tasks/TaskForm';
import { TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from '@/components/tasks/TaskStatusBadge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'all' | 'due_today' | 'overdue' | 'completed';

const TAB_LABELS: Record<TabId, string> = {
  all: 'Όλα',
  due_today: 'Σήμερα',
  overdue: 'Εκπρόθεσμα',
  completed: 'Ολοκληρωμένα',
};

const TAB_ORDER: TabId[] = ['all', 'due_today', 'overdue', 'completed'];

// DTO shapes from backend API
interface TaskDto {
  id: string;
  customerId?: string | null;
  offerId?: string | null;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  dueTime?: string | null;
  note?: string | null;
  createdFromAi?: boolean | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerDto {
  id: string;
  crmNumber?: string | null;
  name?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  status?: string | null;
  preferredContactMethod?: string | null;
  needsSummary?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapTask(dto: TaskDto): Task {
  return {
    id: dto.id,
    customerId: dto.customerId ?? undefined,
    offerId: dto.offerId ?? undefined,
    title: dto.title,
    type: (dto.type as TaskType) ?? 'other',
    // ai_draft is not in TaskBaseStatus but is cast safely. getEffectiveStatus falls through
    // to date-based logic for any unrecognised status, which is the correct behaviour.
    status: dto.status as TaskBaseStatus,
    priority: (dto.priority as TaskPriority) ?? 'normal',
    dueDate: dto.dueDate ?? new Date().toISOString().split('T')[0],
    dueTime: dto.dueTime ?? undefined,
    note: dto.note ?? '',
    createdFromAi: dto.createdFromAi ?? false,
    completedAt: dto.completedAt ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

function mapCustomer(dto: CustomerDto): Customer {
  const now = new Date().toISOString();
  return {
    id: dto.id,
    name: dto.name ?? dto.companyName ?? dto.crmNumber ?? 'Πελάτης',
    companyName: dto.companyName ?? '',
    phone: dto.phone ?? '',
    email: dto.email ?? '',
    address: '',
    source: (dto.source as Customer['source']) ?? 'manual_entry',
    status: (dto.status as Customer['status']) ?? 'new_lead',
    preferredContactMethod:
      (dto.preferredContactMethod as Customer['preferredContactMethod']) ?? 'phone',
    needsSummary: dto.needsSummary ?? '',
    notes: dto.notes ?? '',
    createdAt: dto.createdAt ?? now,
    updatedAt: dto.updatedAt ?? now,
    crmNumber: dto.crmNumber ?? undefined,
  };
}

// Prevent sending ai_draft (or any unknown status) to write endpoints.
function sanitizeWriteStatus(status: string): 'open' | 'completed' | 'cancelled' {
  if (status === 'completed' || status === 'cancelled') return status;
  return 'open';
}

function fmtDue(dueDate: string, dueTime?: string): string {
  try {
    const d = new Date(dueDate + (dueTime ? `T${dueTime}` : 'T00:00'));
    return (
      d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) +
      (dueTime ? ` ${dueTime.slice(0, 5)}` : '')
    );
  } catch {
    return dueDate;
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function PriorityDot({ priority }: { priority: TaskPriority }) {
  const color =
    priority === 'high'
      ? 'bg-red-500'
      : priority === 'low'
      ? 'bg-green-400'
      : 'bg-zinc-300';
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TasksPage() {
  const [hydrated, setHydrated] = useState(false);
  const [noSession, setNoSession] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  const [taskSearch, setTaskSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('');
  const [typeFilter, setTypeFilter] = useState<TaskType | ''>('');

  const loadData = useCallback(async (token: string) => {
    setFetchError(null);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };
      const [tasksResp, customersResp] = await Promise.all([
        fetch('/api/tasks?limit=100', { headers }),
        fetch('/api/customers?limit=100', { headers }),
      ]);

      if (!tasksResp.ok || !customersResp.ok) {
        setFetchError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
        setHydrated(true);
        return;
      }

      const tasksData = await tasksResp.json();
      const customersData = await customersResp.json();

      const rawTasks: TaskDto[] = Array.isArray(tasksData)
        ? tasksData
        : (tasksData.tasks ?? []);
      const rawCustomers: CustomerDto[] = Array.isArray(customersData)
        ? customersData
        : (customersData.customers ?? []);

      // Appointment/visit types belong to /appointments, not /tasks.
      const nextTasks = rawTasks
        .map(mapTask)
        .filter((t) => t.type !== 'book_appointment' && t.type !== 'visit_customer');

      const nextCustomers = rawCustomers.map(mapCustomer);

      // taskId URL param - switch to correct tab and highlight after load.
      const pid =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('taskId')
          : null;
      let tabOverride: TabId | null = null;
      let foundTaskId: string | null = null;
      if (pid) {
        const found = nextTasks.find((t) => t.id === pid);
        if (found) {
          foundTaskId = found.id;
          const eff = getEffectiveStatus(found);
          tabOverride =
            eff === 'completed' || eff === 'cancelled'
              ? 'completed'
              : eff === 'overdue'
              ? 'overdue'
              : eff === 'due_today'
              ? 'due_today'
              : 'all';
        }
      }

      setTasks(nextTasks);
      setCustomers(nextCustomers);
      if (tabOverride) {
        setActiveTab(tabOverride);
        setTaskSearch('');
        setPriorityFilter('');
        setTypeFilter('');
      }
      if (foundTaskId) setFocusedTaskId(foundTaskId);
      setHydrated(true);
    } catch {
      setFetchError('Αποτυχία φόρτωσης. Δοκίμασε ξανά.');
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          setNoSession(true);
          setHydrated(true);
          return;
        }
        tokenRef.current = session.access_token;
        await loadData(session.access_token);
      } catch {
        setFetchError('Αποτυχία σύνδεσης. Δοκίμασε ξανά.');
        setHydrated(true);
      }
    }
    init();
  }, [loadData]);

  // Scroll to focused task after hydration.
  useEffect(() => {
    if (!hydrated || !focusedTaskId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`task-${focusedTaskId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [hydrated, focusedTaskId]);

  // Clear focus when the focused task disappears from the list.
  useEffect(() => {
    if (!hydrated || !focusedTaskId) return;
    const found = tasks.find((t) => t.id === focusedTaskId);
    if (!found) {
      const timer = window.setTimeout(() => {
        setFocusedTaskId(null);
        window.history.replaceState(null, '', '/tasks');
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [tasks, focusedTaskId, hydrated]);

  const hasTaskFilter = taskSearch.trim() !== '' || priorityFilter !== '' || typeFilter !== '';

  function clearFocusedTask() {
    setFocusedTaskId(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/tasks');
    }
  }

  const focusedTask = focusedTaskId ? tasks.find((t) => t.id === focusedTaskId) ?? null : null;

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c.name])),
    [customers]
  );

  const tabCounts = useMemo(() => {
    const counts: Record<TabId, number> = { all: 0, due_today: 0, overdue: 0, completed: 0 };
    for (const t of tasks) {
      const eff = getEffectiveStatus(t);
      if (eff === 'due_today') { counts.due_today++; counts.all++; }
      else if (eff === 'upcoming') { counts.all++; }
      else if (eff === 'overdue') { counts.overdue++; counts.all++; }
      else if (eff === 'completed' || eff === 'cancelled') counts.completed++;
    }
    return counts;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = norm(taskSearch.trim());
    return tasks.filter((t) => {
      const eff = getEffectiveStatus(t);
      let inTab: boolean;
      if (activeTab === 'all') {
        inTab = eff !== 'completed' && eff !== 'cancelled';
      } else if (activeTab === 'completed') {
        inTab = eff === 'completed' || eff === 'cancelled';
      } else {
        inTab = eff === activeTab;
      }
      if (!inTab) return false;

      if (q) {
        const customerName = t.customerId ? norm(customerMap[t.customerId] ?? '') : '';
        const hit =
          norm(t.title).includes(q) ||
          norm(t.note).includes(q) ||
          customerName.includes(q);
        if (!hit) return false;
      }

      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (typeFilter && t.type !== typeFilter) return false;

      return true;
    });
  }, [tasks, activeTab, taskSearch, priorityFilter, typeFilter, customerMap]);

  // Pick the most important open task for the focus card.
  const focusTask = useMemo(() => {
    const open = tasks.filter((t) => {
      const eff = getEffectiveStatus(t);
      return eff !== 'completed' && eff !== 'cancelled';
    });
    const overdue = open.filter((t) => getEffectiveStatus(t) === 'overdue');
    if (overdue.length > 0) return overdue[0];
    const high = open.filter((t) => t.priority === 'high');
    if (high.length > 0) return high[0];
    const today = open.filter((t) => getEffectiveStatus(t) === 'due_today');
    if (today.length > 0) return today[0];
    return open[0] ?? null;
  }, [tasks]);

  function clearTaskFilters() {
    setTaskSearch('');
    setPriorityFilter('');
    setTypeFilter('');
  }

  async function handleComplete(id: string) {
    const token = tokenRef.current;
    if (!token) return;
    const resp = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? mapTask(data.task) : t)));
    }
  }

  // "Delete" patches status to cancelled - no hard-delete endpoint exists yet.
  async function handleDelete(id: string) {
    const token = tokenRef.current;
    if (!token) return;
    const resp = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? mapTask(data.task) : t)));
    }
  }

  function handleEdit(task: Task) {
    setEditingTask(task);
    setShowForm(true);
  }

  async function handleSave(task: Task) {
    const token = tokenRef.current;
    if (!token) return;

    // TaskForm preserves ai_draft status; sanitize before sending to the write endpoint.
    const safeStatus = sanitizeWriteStatus(task.status as string);

    const body = {
      title: task.title,
      type: task.type,
      status: safeStatus,
      priority: task.priority,
      dueDate: task.dueDate,
      dueTime: task.dueTime ?? null,
      note: task.note,
      customerId: task.customerId ?? null,
      offerId: task.offerId ?? null,
    };

    if (editingTask) {
      const resp = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        setTasks((prev) => prev.map((t) => (t.id === task.id ? mapTask(data.task) : t)));
      }
    } else {
      const resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        const created = mapTask(data.task);
        if (created.type !== 'book_appointment' && created.type !== 'visit_customer') {
          setTasks((prev) => [...prev, created]);
        }
      }
    }

    setShowForm(false);
    setEditingTask(null);
  }

  async function handleSnooze(id: string, newDueDate: string) {
    const token = tokenRef.current;
    if (!token) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status !== 'open') return;
    const resp = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: newDueDate }),
    });
    if (resp.ok) {
      const data = await resp.json();
      setTasks((prev) => prev.map((t) => (t.id === id ? mapTask(data.task) : t)));
    }
  }

  function handleCancelForm() {
    setShowForm(false);
    setEditingTask(null);
  }

  function openNewForm() {
    setEditingTask(null);
    setShowForm(true);
  }

  // ---------------------------------------------------------------------------
  // Loading / error / no-session states
  // ---------------------------------------------------------------------------

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-md px-5 pt-6 pb-28">
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm text-zinc-400">Φόρτωση tasks...</p>
        </div>
      </div>
    );
  }

  if (noSession) {
    return (
      <div className="mx-auto max-w-md px-5 pt-6 pb-28">
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="mb-4 text-sm text-zinc-600">Συνδέσου για να δεις τα tasks.</p>
          <Link
            href="/login/backend"
            className="inline-block rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Σύνδεση
          </Link>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="mx-auto max-w-md px-5 pt-6 pb-28">
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="mb-4 text-sm text-red-600">{fetchError}</p>
          <button
            type="button"
            onClick={() => {
              const token = tokenRef.current;
              if (token) {
                setHydrated(false);
                loadData(token);
              }
            }}
            className="inline-block rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Δοκίμασε ξανά
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-md space-y-5 px-5 pt-6 pb-28">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-400">Tasks</p>
          <h1 className="mt-0.5 text-2xl font-bold text-zinc-900">Τι πρέπει να γίνει;</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Οι εκκρεμότητες που χρειάζονται προσοχή σήμερα.
          </p>
        </div>
        <button
          type="button"
          onClick={showForm && !editingTask ? handleCancelForm : openNewForm}
          className={`mt-1 shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
            showForm && !editingTask
              ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800'
          }`}
        >
          {showForm && !editingTask ? 'Ακύρωση' : '+ Νέο task'}
        </button>
      </div>

      {/* Create / edit form */}
      {showForm && (
        <div className="rounded-[28px] bg-white px-5 py-5 shadow-sm ring-1 ring-zinc-200/60">
          <TaskForm
            initial={editingTask ?? undefined}
            customers={customers}
            onSave={handleSave}
            onCancel={handleCancelForm}
          />
        </div>
      )}

      {/* Focus banner - shown when arriving from dashboard with a taskId param */}
      {focusedTask && (
        <div className="flex items-center justify-between gap-3 rounded-[28px] bg-indigo-50 px-5 py-4 ring-1 ring-indigo-100">
          <div className="min-w-0">
            <p className="text-xs font-medium text-indigo-600">Άνοιξες task από το dashboard</p>
            <p className="truncate text-sm font-semibold text-indigo-900">{focusedTask.title}</p>
          </div>
          <button
            type="button"
            onClick={clearFocusedTask}
            className="shrink-0 rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
          >
            Κλείσιμο
          </button>
        </div>
      )}

      {/* Primary focus card */}
      <div className="rounded-[28px] bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200/60">
        <p className="text-xs font-medium text-zinc-400">Επόμενη ενέργεια</p>
        {focusTask ? (
          <div className="mt-2">
            <div className="flex items-start gap-2.5">
              <div className="mt-1 shrink-0">
                <PriorityDot priority={focusTask.priority} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-snug text-zinc-900">
                  {focusTask.title}
                </p>
                {focusTask.customerId && customerMap[focusTask.customerId] && (
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {customerMap[focusTask.customerId]}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-zinc-400">
                  {fmtDue(focusTask.dueDate, focusTask.dueTime)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              {focusTask.customerId ? (
                <Link
                  href={`/customers/${focusTask.customerId}?focusTask=${focusTask.id}`}
                  className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
                >
                  Άνοιγμα
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const eff = getEffectiveStatus(focusTask);
                    setActiveTab(
                      eff === 'completed' || eff === 'cancelled'
                        ? 'completed'
                        : eff === 'overdue'
                        ? 'overdue'
                        : eff === 'due_today'
                        ? 'due_today'
                        : 'all'
                    );
                    const el = document.getElementById(`task-${focusTask.id}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 active:bg-indigo-800"
                >
                  Άνοιγμα
                </button>
              )}
              <button
                type="button"
                onClick={() => handleComplete(focusTask.id)}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
              >
                Ολοκλήρωση
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-zinc-500">Χωρίς επείγουσες εκκρεμότητες.</p>
        )}
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Σήμερα', count: tabCounts.due_today, urgent: false },
          {
            label: 'Εκπρόθεσμα',
            count: tabCounts.overdue,
            urgent: tabCounts.overdue > 0,
          },
          { label: 'Ανοιχτά', count: tabCounts.all, urgent: false },
        ].map(({ label, count, urgent }) => (
          <div
            key={label}
            className="rounded-[28px] bg-white px-3 py-3 text-center shadow-sm ring-1 ring-zinc-200/60"
          >
            <p className={`text-xl font-bold ${urgent ? 'text-red-600' : 'text-zinc-900'}`}>
              {count}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter chips + search */}
      <div className="space-y-3">
        {/* Tab chips */}
        <div className="flex flex-wrap gap-2">
          {TAB_ORDER.map((tab) => {
            const isActive = tab === activeTab;
            const count = tabCounts[tab];
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-zinc-600 ring-1 ring-zinc-200 hover:ring-indigo-300'
                }`}
              >
                {TAB_LABELS[tab]}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : tab === 'overdue'
                        ? 'bg-red-50 text-red-600'
                        : 'bg-zinc-100 text-zinc-500'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="flex items-center gap-3 rounded-[28px] bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200/60">
          <svg
            className="h-4 w-4 shrink-0 text-zinc-400"
            fill="none"
            strokeWidth={1.5}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="search"
            value={taskSearch}
            onChange={(e) => setTaskSearch(e.target.value)}
            placeholder="Αναζήτηση τίτλου, σημείωσης, πελάτη..."
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder-zinc-400 outline-none"
          />
        </div>

        {/* Priority + type selects */}
        <div className="flex flex-wrap gap-2">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}
            className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
          >
            <option value="">Όλες οι προτεραιότητες</option>
            {(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TaskType | '')}
            className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition"
          >
            <option value="">Όλοι οι τύποι</option>
            {(Object.entries(TASK_TYPE_LABELS) as [TaskType, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          {hasTaskFilter && (
            <button
              type="button"
              onClick={clearTaskFilters}
              className="rounded-2xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Καθαρισμός
            </button>
          )}
        </div>
      </div>

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <div className="rounded-[28px] bg-white px-5 py-10 text-center shadow-sm ring-1 ring-zinc-200/60">
          <p className="text-sm font-medium text-zinc-700">
            {hasTaskFilter
              ? 'Δεν βρέθηκαν αποτελέσματα.'
              : tasks.length === 0
              ? 'Δεν υπάρχουν tasks.'
              : activeTab === 'overdue'
              ? 'Δεν υπάρχουν εκπρόθεσμα tasks.'
              : activeTab === 'due_today'
              ? 'Δεν έχεις ανοιχτά tasks για σήμερα.'
              : activeTab === 'completed'
              ? 'Δεν υπάρχουν ολοκληρωμένα tasks.'
              : 'Δεν υπάρχουν tasks.'}
          </p>
          {tasks.length === 0 && !hasTaskFilter && (
            <p className="mt-1.5 text-sm text-zinc-400">
              Όταν δημιουργούνται εργασίες από κλήσεις ή AI εντολές, θα εμφανίζονται εδώ.
            </p>
          )}
          {hasTaskFilter && (
            <button
              type="button"
              onClick={clearTaskFilters}
              className="mt-3 rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-600 transition hover:ring-1 hover:ring-indigo-300"
            >
              Καθαρισμός φίλτρων
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {filteredTasks.map((task) => (
            <li
              key={task.id}
              id={`task-${task.id}`}
              className={
                task.id === focusedTaskId
                  ? 'rounded-[28px] outline outline-2 outline-offset-2 outline-indigo-400'
                  : ''
              }
            >
              {task.customerId && (
                <div className="mb-1.5 flex justify-end px-1">
                  <Link
                    href={`/customers/${task.customerId}?focusTask=${task.id}`}
                    className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600 ring-1 ring-indigo-100 transition hover:bg-indigo-100"
                  >
                    Άνοιγμα στον πελάτη
                  </Link>
                </div>
              )}
              <TaskCard
                task={task}
                customerName={task.customerId ? customerMap[task.customerId] : undefined}
                onComplete={handleComplete}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSnooze={handleSnooze}
              />
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
