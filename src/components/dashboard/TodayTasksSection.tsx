import { demoTodayTasks, type DemoPriority, type DemoTaskStatus } from '@/lib/demo-data';

function DisabledBtn({ label }: { label: string }) {
  return (
    <button
      disabled
      className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-400 ring-1 ring-zinc-200"
    >
      {label}
      <span className="text-zinc-300">·</span>
      <span>Σύντομα</span>
    </button>
  );
}

function StatusBadge({ status }: { status: DemoTaskStatus }) {
  if (status === 'overdue') {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
        Εκπρόθεσμο
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
      Σήμερα
    </span>
  );
}

function PriorityDot({ priority }: { priority: DemoPriority }) {
  const color =
    priority === 'high'
      ? 'bg-red-500'
      : priority === 'normal'
      ? 'bg-zinc-400'
      : 'bg-zinc-300';
  return <span className={`inline-block h-2 w-2 rounded-full ${color} shrink-0 mt-1.5`} />;
}

export default function TodayTasksSection() {
  const count = demoTodayTasks.length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Σημερινά tasks
        </h2>
        {count > 0 && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
            {count}
          </span>
        )}
      </div>

      {count === 0 ? (
        <p className="text-sm text-zinc-500">Δεν έχεις ανοιχτά tasks για σήμερα.</p>
      ) : (
        <ul className="space-y-2">
          {demoTodayTasks.map((task) => (
            <li
              key={task.id}
              className={`rounded-2xl p-4 ring-1 ${
                task.status === 'overdue'
                  ? 'bg-red-50 ring-red-200'
                  : 'bg-white ring-zinc-100 shadow-sm'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <PriorityDot priority={task.priority} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={`text-sm font-semibold ${
                        task.status === 'overdue' ? 'text-red-900' : 'text-zinc-900'
                      }`}
                    >
                      {task.title}
                    </p>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                    <span>{task.customerName}</span>
                    <span className="text-zinc-300">·</span>
                    <span>{task.typeLabel}</span>
                    <span className="text-zinc-300">·</span>
                    <span>{task.dueLabel}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <DisabledBtn label="Ολοκλήρωση" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
