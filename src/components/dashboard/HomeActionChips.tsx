'use client';

// Home "Τι έχω για σήμερα;" chips (redesign P4c). Two tappable chips under the
// greeting: «[#] Ραντεβού» (opens an agenda popup of upcoming appointments) and
// «Να πάρω τηλέφωνο [#]» (opens the call-back list). Both derive from open tasks
// (book_appointment/visit_customer vs call_back), joined to customer names. Tapping
// an item opens that customer's Messenger chat.

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { formatDateGr } from '@/lib/date';
import { EmptyState } from '@/components/ui';

interface TaskDto {
  id: string; customerId: string | null; title: string | null; type: string;
  status: string; dueDate: string | null; dueTime: string | null; note: string | null;
}
interface Item {
  id: string; customerId: string | null; customerName: string;
  dueDate: string | null; dueTime: string | null; note: string | null; phone: string | null;
}

const APPT_TYPES = new Set(['book_appointment', 'visit_customer']);

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { Authorization: `Bearer ${session.access_token}` };
  } catch {
    return null;
  }
}

const fmtDay = formatDateGr;

export default function HomeActionChips() {
  const router = useRouter();
  const [appts, setAppts] = useState<Item[]>([]);
  const [callbacks, setCallbacks] = useState<Item[]>([]);
  const [openView, setOpenView] = useState<null | 'appts' | 'callbacks'>(null);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) return;
    try {
      const [tRes, cRes] = await Promise.all([
        fetch('/api/tasks?status=open&limit=100', { headers }),
        fetch('/api/customers?limit=300', { headers }),
      ]);
      const tJson = await tRes.json().catch(() => ({}));
      const cJson = await cRes.json().catch(() => ({}));
      const names = new Map<string, { name: string; phone: string | null }>();
      if (cJson?.ok && Array.isArray(cJson.customers)) {
        for (const c of cJson.customers as Array<{ id: string; name: string | null; mobilePhone: string | null; phone: string | null }>) {
          names.set(c.id, { name: c.name ?? 'Πελάτης', phone: c.mobilePhone || c.phone || null });
        }
      }
      const tasks: TaskDto[] = tJson?.ok && Array.isArray(tJson.tasks) ? tJson.tasks : [];
      const toItem = (t: TaskDto): Item => {
        const c = t.customerId ? names.get(t.customerId) : undefined;
        return { id: t.id, customerId: t.customerId, customerName: c?.name ?? 'Πελάτης', dueDate: t.dueDate, dueTime: t.dueTime, note: t.note, phone: c?.phone ?? null };
      };
      const cmp = (a: Item, b: Item) => `${a.dueDate ?? ''} ${a.dueTime ?? ''}`.localeCompare(`${b.dueDate ?? ''} ${b.dueTime ?? ''}`);
      setAppts(tasks.filter((t) => APPT_TYPES.has(t.type)).map(toItem).sort(cmp));
      setCallbacks(tasks.filter((t) => t.type === 'call_back').map(toItem).sort(cmp));
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openCustomer(id: string | null) {
    if (id) { setOpenView(null); router.push(`/customers/${id}/chat`); }
  }

  const list = openView === 'appts' ? appts : callbacks;

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setOpenView('appts')} className="flex items-center gap-3 rounded-[24px] bg-white dark:bg-[#17232f] px-4 py-3.5 text-left shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 transition active:scale-[0.98] active:bg-zinc-50 dark:active:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600" aria-hidden>
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-2xl font-bold leading-none tabular-nums text-zinc-900 dark:text-zinc-100">{appts.length}</span>
            <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">Ραντεβού</span>
          </span>
        </button>
        <button type="button" onClick={() => setOpenView('callbacks')} className="flex items-center gap-3 rounded-[24px] bg-white dark:bg-[#17232f] px-4 py-3.5 text-left shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 transition active:scale-[0.98] active:bg-zinc-50 dark:active:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-indigo-600" aria-hidden>
            <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-2xl font-bold leading-none tabular-nums text-zinc-900 dark:text-zinc-100">{callbacks.length}</span>
            <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">Να πάρω τηλέφωνο</span>
          </span>
        </button>
      </div>

      {openView && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
          <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30 motion-safe:animate-[fadeIn_0.16s]" onClick={() => setOpenView(null)} />
          <div className="relative mx-auto max-h-[80dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white dark:bg-[#17232f] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl motion-safe:animate-[sheetUp_0.22s_ease-out]">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200 dark:bg-white/10" />
            <p className="mb-2 px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{openView === 'appts' ? 'Ραντεβού' : 'Να πάρω τηλέφωνο'}</p>
            {list.length === 0 ? (
              <EmptyState
                title={openView === 'appts' ? 'Κανένα ραντεβού' : 'Καμία εκκρεμότητα κλήσης'}
                description={openView === 'appts' ? 'Δεν υπάρχουν επερχόμενα ραντεβού.' : 'Δεν εκκρεμεί καμία κλήση αυτή τη στιγμή.'}
                icon={
                  openView === 'appts' ? (
                    <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" /></svg>
                  ) : (
                    <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
                  )
                }
              />
            ) : (
              <div className="space-y-1.5 pb-2">
                {list.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 rounded-[24px] bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 ring-1 ring-zinc-200/60 dark:ring-white/10">
                    <button type="button" onClick={() => openCustomer(it.customerId)} className="min-w-0 flex-1 rounded-lg text-left transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{it.customerName}</p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {openView === 'appts'
                          ? `${fmtDay(it.dueDate)}${it.dueTime ? ` · ${it.dueTime}` : ''}${it.note ? ` · ${it.note}` : ''}`
                          : (it.note || 'Επιστροφή κλήσης')}
                      </p>
                    </button>
                    {it.phone && (
                      <a href={`tel:${it.phone}`} aria-label="Κλήση" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white dark:bg-[#17232f] text-indigo-600 ring-1 ring-zinc-200/60 dark:ring-white/10 transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                        <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
