import { demoMissedCalls } from '@/lib/demo-data';

function DisabledBtn({ label }: { label: string }) {
  return (
    <button
      disabled
      className="inline-flex cursor-not-allowed items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-zinc-400 ring-1 ring-zinc-200"
    >
      {label}
      <span className="text-zinc-300">·</span>
      <span>Σύντομα</span>
    </button>
  );
}

export default function MissedCallsSection() {
  const count = demoMissedCalls.length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Χαμένες κλήσεις
        </h2>
        {count > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
            {count}
          </span>
        )}
      </div>

      {count === 0 ? (
        <p className="text-sm text-zinc-500">
          Δεν υπάρχουν χαμένες κλήσεις αυτή τη στιγμή.
        </p>
      ) : (
        <ul className="space-y-2">
          {demoMissedCalls.map((call) => (
            <li
              key={call.id}
              className="rounded-2xl bg-red-50 p-4 ring-1 ring-red-200"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-red-900">
                      {call.customerName ?? call.phoneDisplay}
                    </span>
                    {call.isUnknown && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                        Άγνωστος αριθμός
                      </span>
                    )}
                  </div>
                  {call.customerName && (
                    <p className="mt-0.5 text-xs text-zinc-500">{call.phoneDisplay}</p>
                  )}
                  <p className="mt-0.5 text-xs text-zinc-500">{call.timeLabel}</p>
                </div>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100">
                  <svg
                    className="h-4 w-4 text-red-600"
                    fill="none"
                    strokeWidth={2}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z"
                    />
                  </svg>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <DisabledBtn label="Call back" />
                {call.isUnknown ? (
                  <DisabledBtn label="Προσθήκη στο CRM" />
                ) : (
                  <DisabledBtn label="Άνοιγμα πελάτη" />
                )}
                <DisabledBtn label="Το χειρίστηκα" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
