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
        <button type="button" onClick={() => setOpenView('appts')} className="flex items-center gap-3 rounded-[24px] bg-white px-4 py-3.5 text-left shadow-sm ring-1 ring-zinc-200/60 transition active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xl" aria-hidden>📅</span>
          <span className="min-w-0">
            <span className="block text-lg font-bold leading-none text-zinc-900">{appts.length}</span>
            <span className="block text-xs text-zinc-500">Ραντεβού</span>
          </span>
        </button>
        <button type="button" onClick={() => setOpenView('callbacks')} className="flex items-center gap-3 rounded-[24px] bg-white px-4 py-3.5 text-left shadow-sm ring-1 ring-zinc-200/60 transition active:bg-zinc-50">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xl" aria-hidden>📞</span>
          <span className="min-w-0">
            <span className="block text-lg font-bold leading-none text-zinc-900">{callbacks.length}</span>
            <span className="block text-xs text-zinc-500">Να πάρω τηλέφωνο</span>
          </span>
        </button>
      </div>

      {openView && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
          <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30" onClick={() => setOpenView(null)} />
          <div className="relative mx-auto max-h-[80dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 shadow-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-200" />
            <p className="mb-2 px-1 text-sm font-semibold text-zinc-900">{openView === 'appts' ? 'Ραντεβού' : 'Να πάρω τηλέφωνο'}</p>
            {list.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-400">{openView === 'appts' ? 'Κανένα ραντεβού.' : 'Καμία εκκρεμότητα κλήσης.'}</p>
            ) : (
              <div className="space-y-1.5 pb-2">
                {list.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 rounded-2xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-200/60">
                    <button type="button" onClick={() => openCustomer(it.customerId)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-semibold text-zinc-900">{it.customerName}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {openView === 'appts'
                          ? `${fmtDay(it.dueDate)}${it.dueTime ? ` · ${it.dueTime}` : ''}${it.note ? ` · ${it.note}` : ''}`
                          : (it.note || 'Επιστροφή κλήσης')}
                      </p>
                    </button>
                    {it.phone && (
                      <a href={`tel:${it.phone}`} aria-label="Κλήση" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-indigo-600 ring-1 ring-zinc-200">
                        <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
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
