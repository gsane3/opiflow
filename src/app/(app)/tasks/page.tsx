'use client';

import { useState, useMemo, useEffect } from 'react';
import { loadState, saveState, addTask, updateTask, deleteTask } from '@/lib/storage';
import { generateDemoTasks } from '@/lib/demo-data';
import type { Task, Customer, TaskBaseStatus, TaskType, TaskPriority } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import { norm } from '@/lib/search';
import TaskCard from '@/components/tasks/TaskCard';
import TaskForm from '@/components/tasks/TaskForm';
import DuplicateTasksPanel from '@/components/tasks/DuplicateTasksPanel';
import { TASK_TYPE_LABELS, TASK_PRIORITY_LABELS } from '@/components/tasks/TaskStatusBadge';
import PageHelp from '@/components/common/PageHelp';

type TabId = 'due_today' | 'upcoming' | 'overdue' | 'completed';

const TAB_LABELS: Record<TabId, string> = {
  overdue: 'Εκπρόθεσμα',
  due_today: 'Σήμερα',
  upcoming: 'Επερχόμενα',
  completed: 'Ολοκληρωμένα',
};

const TAB_ORDER: TabId[] = ['due_today', 'upcoming', 'overdue', 'completed'];

const EMPTY_STATES: Record<TabId, string> = {
  overdue: 'Δεν υπάρχουν εκπρόθεσμα tasks.',
  due_today: 'Δεν έχεις ανοιχτά tasks για σήμερα.',
  upcoming: 'Δεν υπάρχουν επερχόμενα tasks.',
  completed: 'Δεν υπάρχουν ολοκληρωμένα tasks.',
};

const selCls =
  'rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-sm text-zinc-700 outline-none focus:border-indigo-400';

export default function TasksPage() {
  // Start with empty arrays so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('due_today');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);

  // Search + filter state (does not affect tab counts)
  const [taskSearch, setTaskSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('');
  const [typeFilter, setTypeFilter] = useState<TaskType | ''>('');

  // Load localStorage after mount to avoid hydration mismatch.
  // If taskId URL param is present and found, switch to correct tab and clear filters.
  // setState calls are deferred into a timer so they are not synchronous in the effect body.
  useEffect(() => {
    const state = loadState();
    let nextTasks: Task[];
    const nextCustomers: Customer[] = state.customers ?? [];
    if (state.tasks === undefined) {
      const seeded = generateDemoTasks();
      saveState({ tasks: seeded });
      nextTasks = seeded;
    } else {
      nextTasks = state.tasks;
    }
    // Appointment tasks belong to /appointments, not /tasks.
    nextTasks = nextTasks.filter((t) => t.type !== 'book_appointment');

    // Determine if we should focus a specific task from the URL param.
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
            : 'upcoming';
      }
    }

    const timer = window.setTimeout(() => {
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
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // After hydration, scroll to the focused task.
  useEffect(() => {
    if (!hydrated || !focusedTaskId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`task-${focusedTaskId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    return () => clearTimeout(timer);
  }, [hydrated, focusedTaskId]);

  const hasTaskFilter = taskSearch.trim() !== '' || priorityFilter !== '' || typeFilter !== '';

  // Clear focused task highlight and remove taskId from URL.
  function clearFocusedTask() {
    setFocusedTaskId(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/tasks');
    }
  }

  // Clear focus when the focused task is completed or deleted.
  // setState is deferred into a timer to avoid react-hooks/set-state-in-effect.
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

  const focusedTask = focusedTaskId ? tasks.find((t) => t.id === focusedTaskId) ?? null : null;

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c.name])),
    [customers]
  );

  // Tab counts — based on ALL tasks, unaffected by search/filter
  const tabCounts = useMemo(() => {
    const counts: Record<TabId, number> = { due_today: 0, upcoming: 0, overdue: 0, completed: 0 };
    for (const t of tasks) {
      const eff = getEffectiveStatus(t);
      if (eff === 'due_today') counts.due_today++;
      else if (eff === 'upcoming') counts.upcoming++;
      else if (eff === 'overdue') counts.overdue++;
      else if (eff === 'completed' || eff === 'cancelled') counts.completed++;
    }
    return counts;
  }, [tasks]);

  // Filtered list — tab first, then search+filter within tab
  const filteredTasks = useMemo(() => {
    const q = norm(taskSearch.trim());
    return tasks.filter((t) => {
      const eff = getEffectiveStatus(t);
      const inTab =
        activeTab === 'completed'
          ? eff === 'completed' || eff === 'cancelled'
          : eff === activeTab;
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

  function clearTaskFilters() {
    setTaskSearch('');
    setPriorityFilter('');
    setTypeFilter('');
  }

  function handleComplete(id: string) {
    const now = new Date().toISOString();
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const completed = { ...task, status: 'completed' as TaskBaseStatus, completedAt: now, updatedAt: now };
    updateTask(completed);
    setTasks((prev) => prev.map((t) => (t.id === id ? completed : t)));
  }

  function handleDelete(id: string) {
    deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  function handleDeleteManyTasks(taskIds: string[]) {
    for (const id of taskIds) {
      deleteTask(id);
    }
    setTasks((prev) => prev.filter((t) => !taskIds.includes(t.id)));
  }

  function handleEdit(task: Task) {
    setEditingTask(task);
    setShowForm(true);
  }

  function handleSave(task: Task) {
    if (editingTask) {
      updateTask(task);
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
    } else {
      addTask(task);
      setTasks((prev) => [...prev, task]);
    }
    setShowForm(false);
    setEditingTask(null);
  }

  function handleSnooze(id: string, newDueDate: string) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    // Only snooze open tasks — completed/cancelled tasks cannot be snoozed.
    if (task.status !== 'open') return;
    const snoozed = { ...task, dueDate: newDueDate, updatedAt: new Date().toISOString() };
    updateTask(snoozed);
    setTasks((prev) => prev.map((t) => (t.id === id ? snoozed : t)));
  }

  function handleCancelForm() {
    setShowForm(false);
    setEditingTask(null);
  }

  function openNewForm() {
    setEditingTask(null);
    setShowForm(true);
  }

  // Stable shell shown on server and first client render — no localStorage-derived content.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-zinc-900">Tasks</h1>
          <button
            type="button"
            className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
          >
            + Νέο task
          </button>
        </div>
        <div className="mb-3 -mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
          {TAB_ORDER.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                tab === 'due_today'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-600'
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <p className="py-10 text-center text-sm text-zinc-400">Φόρτωση tasks...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <div className="mb-4">
        <PageHelp title="Τι βλέπω εδώ;">
          <p className="text-sm text-zinc-600">
            Εδώ βλέπεις όλες τις εκκρεμότητες. Άνοιξε ένα task ή πάτα Ολοκλήρωση.
          </p>
          <ul className="space-y-1 mt-1">
            {[
              'Πάτα «Ολοκλήρωση» για να κλείσεις ένα task.',
              'Πάτα «Περισσότερα» για αναβολή, επεξεργασία ή διαγραφή.',
              'Δεν χαλάς τίποτα — μπορείς να επαναφέρεις οποτεδήποτε.',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-xs text-zinc-500">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                {t}
              </li>
            ))}
          </ul>
        </PageHelp>
      </div>

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-zinc-900">Tasks</h1>
        <button
          type="button"
          onClick={showForm && !editingTask ? handleCancelForm : openNewForm}
          className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
            showForm && !editingTask
              ? 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
          }`}
        >
          {showForm && !editingTask ? 'Ακύρωση' : '+ Νέο task'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="mb-5">
          <TaskForm
            initial={editingTask ?? undefined}
            customers={customers}
            onSave={handleSave}
            onCancel={handleCancelForm}
          />
        </div>
      )}

      {/* Duplicate follow-up task cleanup panel */}
      <DuplicateTasksPanel tasks={tasks} onDeleteMany={handleDeleteManyTasks} />

      {/* Focus banner — shown when arriving from dashboard with a taskId param */}
      {focusedTask && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-indigo-50 px-4 py-3 ring-1 ring-indigo-200">
          <div className="min-w-0">
            <p className="text-xs font-medium text-indigo-600">Άνοιξες task από το dashboard</p>
            <p className="truncate text-sm font-semibold text-indigo-900">{focusedTask.title}</p>
          </div>
          <button
            type="button"
            onClick={clearFocusedTask}
            className="shrink-0 rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50"
          >
            Καθαρισμός εστίασης
          </button>
        </div>
      )}

      {/* Tabs — counts are total per tab, unaffected by search/filter */}
      <div className="mb-3 -mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
        {TAB_ORDER.map((tab) => {
          const count = tabCounts[tab];
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                active
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {TAB_LABELS[tab]}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                    active
                      ? 'bg-white/20 text-white'
                      : tab === 'overdue'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-zinc-200 text-zinc-600'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search + filters within active tab */}
      <div className="mb-4 space-y-2">
        <input
          type="search"
          value={taskSearch}
          onChange={(e) => setTaskSearch(e.target.value)}
          placeholder="Αναζήτηση τίτλου, σημείωσης, πελάτη..."
          className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}
            className={selCls}
          >
            <option value="">Όλες οι προτεραιότητες</option>
            {(Object.entries(TASK_PRIORITY_LABELS) as [TaskPriority, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TaskType | '')}
            className={selCls}
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
              className="rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-50"
            >
              Καθαρισμός
            </button>
          )}
        </div>
      </div>

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <div className="rounded-2xl bg-zinc-50 px-5 py-8 text-center ring-1 ring-zinc-100">
          <p className="text-sm font-medium text-zinc-500">
            {hasTaskFilter ? 'Δεν βρέθηκαν αποτελέσματα για αυτά τα φίλτρα.' : EMPTY_STATES[activeTab]}
          </p>
          {!hasTaskFilter && activeTab !== 'completed' && (
            <p className="mt-1 text-sm text-zinc-400">
              Πρόσθεσε task με το κουμπί + παραπάνω.
            </p>
          )}
          {hasTaskFilter && (
            <button
              type="button"
              onClick={clearTaskFilters}
              className="mt-3 rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-600 ring-1 ring-zinc-200 transition hover:ring-indigo-300"
            >
              Καθαρισμός φίλτρων
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filteredTasks.map((task) => (
            <li
              key={task.id}
              id={`task-${task.id}`}
              className={
                task.id === focusedTaskId
                  ? 'rounded-2xl outline outline-2 outline-offset-2 outline-indigo-400'
                  : ''
              }
            >
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
