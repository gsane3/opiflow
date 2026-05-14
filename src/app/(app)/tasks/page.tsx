'use client';

import { useState, useMemo } from 'react';
import { loadState, saveState, addTask, updateTask, deleteTask } from '@/lib/storage';
import { generateDemoTasks } from '@/lib/demo-data';
import type { Task, Customer, TaskBaseStatus } from '@/lib/types';
import { getEffectiveStatus } from '@/lib/types';
import TaskCard from '@/components/tasks/TaskCard';
import TaskForm from '@/components/tasks/TaskForm';

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

function initTasks(): Task[] {
  if (typeof window === 'undefined') return [];
  const state = loadState();
  if (state.tasks === undefined) {
    const seeded = generateDemoTasks();
    saveState({ tasks: seeded });
    return seeded;
  }
  return state.tasks;
}

function initCustomers(): Customer[] {
  if (typeof window === 'undefined') return [];
  return loadState().customers ?? [];
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>(initTasks);
  const [customers] = useState<Customer[]>(initCustomers);
  const [activeTab, setActiveTab] = useState<TabId>('due_today');
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map((c) => [c.id, c.name])),
    [customers]
  );

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

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const eff = getEffectiveStatus(t);
      if (activeTab === 'completed') return eff === 'completed' || eff === 'cancelled';
      return eff === activeTab;
    });
  }, [tasks, activeTab]);

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

  function handleCancelForm() {
    setShowForm(false);
    setEditingTask(null);
  }

  function openNewForm() {
    setEditingTask(null);
    setShowForm(true);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
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

      {/* Tabs — scroll horizontally inside their own row */}
      <div className="mb-4 -mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
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

      {/* Task list */}
      {filteredTasks.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">{EMPTY_STATES[activeTab]}</p>
      ) : (
        <ul className="space-y-2">
          {filteredTasks.map((task) => (
            <li key={task.id}>
              <TaskCard
                task={task}
                customerName={task.customerId ? customerMap[task.customerId] : undefined}
                onComplete={handleComplete}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
