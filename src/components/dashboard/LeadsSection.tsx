import { demoLeads } from '@/lib/demo-data';

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

export default function LeadsSection() {
  const count = demoLeads.length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Leads για κλήση
        </h2>
        {count > 0 && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600">
            {count}
          </span>
        )}
      </div>

      {count === 0 ? (
        <p className="text-sm text-zinc-500">
          Δεν υπάρχουν leads που περιμένουν κλήση.
        </p>
      ) : (
        <ul className="space-y-2">
          {demoLeads.map((lead) => (
            <li
              key={lead.id}
              className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-100"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900">{lead.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600">
                      {lead.source}
                    </span>
                    {lead.opportunityValue && (
                      <span>€{lead.opportunityValue.toLocaleString('el-GR')}</span>
                    )}
                    <span
                      className={
                        lead.waitingDays >= 4
                          ? 'text-red-600 font-medium'
                          : lead.waitingDays >= 2
                          ? 'text-amber-600 font-medium'
                          : 'text-zinc-400'
                      }
                    >
                      Αναμένει {lead.waitingLabel}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <DisabledBtn label="Κλήση" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
