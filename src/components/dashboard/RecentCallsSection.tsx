import { demoRecentCalls } from '@/lib/demo-data';

function InboundIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-green-600"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-label="Εισερχόμενη"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" />
    </svg>
  );
}

function OutboundIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-blue-500"
      fill="none"
      strokeWidth={2}
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-label="Εξερχόμενη"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 4.5 4.5 19.5m0 0h11.25m-11.25 0V8.25" />
    </svg>
  );
}

export default function RecentCallsSection() {
  const calls = demoRecentCalls;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Πρόσφατες κλήσεις
        </h2>
      </div>

      {calls.length === 0 ? (
        <p className="text-sm text-zinc-500">Δεν υπάρχουν πρόσφατες κλήσεις.</p>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 overflow-hidden">
          <ul className="divide-y divide-zinc-100">
            {calls.map((call) => (
              <li key={call.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-50 ring-1 ring-zinc-200">
                  {call.direction === 'inbound' ? <InboundIcon /> : <OutboundIcon />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800">
                    {call.nameOrNumber}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {call.durationLabel} · {call.timeLabel}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-zinc-100 px-4 py-2.5">
            <p className="text-xs text-zinc-400">
              Demo κλήσεις. Δεν έγινε πραγματική τηλεφωνική κλήση ή ηχογράφηση.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
