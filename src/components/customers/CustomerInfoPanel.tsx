'use client';

// Customer info slide-over (redesign P3c + feedback v2). Opened from the ⓘ button
// in the Messenger chat. Everything about the customer lives here in sections that
// are ALWAYS visible (so placements are learnable) — each shows an empty state when
// there's nothing yet:
//   editable contact details · offers · appointments · media gallery · call briefs ·
//   internal note · reject.
// `initialSection` scrolls to a section on open (used by clickable chat bubbles:
// intake→contact, appointment→appointments). `autoOpenGallery` opens the lightbox
// (photo bubble tap).

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { buildMapsUrl } from '@/lib/maps';
import { formatDateGr } from '@/lib/date';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import FileGallery, { type GalleryFile } from './FileGallery';

export type InfoSection = 'contact' | 'offers' | 'appointments' | 'files' | 'calls';

interface CustomerFull {
  id: string; name: string | null; companyName: string | null; crmNumber: string | null;
  phone: string | null; mobilePhone: string | null; landlinePhone: string | null;
  email: string | null; address: string | null; notes: string | null;
  status: string | null; opportunityValue: number | null;
}
interface OfferLite { id: string; offerNumber: string | null; status: string; total: number | null; offerDate: string | null }
interface TaskLite { id: string; type: string; status: string; dueDate: string | null; dueTime: string | null; title: string | null; note: string | null }
interface UploadFile { name: string; kind?: string; mimeType?: string }
interface UploadSession { id: string; files: UploadFile[] | null; uploaded_at: string }

export interface BriefEntry { id: string; title: string; body: string; occurredAt: string }

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}
const fmtDate = formatDateGr;
const STATUS_GR: Record<string, string> = { new: 'Νέος', in_progress: 'Σε εξέλιξη', won: 'Κερδισμένος', lost: 'Χαμένος' };
const STATUS_TONE: Record<string, BadgeTone> = { new: 'indigo', in_progress: 'amber', follow_up: 'amber', won: 'green', lost: 'red' };
const OFFER_STATUS_GR: Record<string, string> = { draft: 'Πρόχειρη', ready_to_send: 'Έτοιμη', sent_manually: 'Στάλθηκε', accepted: 'Αποδεκτή', rejected: 'Απορρίφθηκε', expired: 'Έληξε' };
const APPT_TYPES = new Set(['book_appointment', 'visit_customer']);

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <EmptyState
      className="px-2 py-6"
      icon={
        <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75" />
        </svg>
      }
      title={text}
    />
  );
}

// Small inline "saved" confirmation: stroke check + label, fades in.
function SavedCheck({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 motion-safe:animate-[fadeIn_0.2s_ease-out]">
      <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
      {label}
    </span>
  );
}

// Pulsing placeholder mirroring a SectionCard while data loads.
function SectionCardSkeleton() {
  return (
    <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
      <div className="h-3 w-28 rounded bg-zinc-200/80" />
      <div className="mt-3 space-y-2">
        <div className="h-10 rounded-xl bg-zinc-100" />
        <div className="h-10 w-3/4 rounded-xl bg-zinc-100" />
      </div>
    </div>
  );
}

export default function CustomerInfoPanel({
  customerId, open, onClose, callBriefs, initialSection = null, autoOpenGallery = false,
}: {
  customerId: string; open: boolean; onClose: () => void; callBriefs: BriefEntry[];
  initialSection?: InfoSection | null; autoOpenGallery?: boolean;
}) {
  const [customer, setCustomer] = useState<CustomerFull | null>(null);
  const [offers, setOffers] = useState<OfferLite[]>([]);
  const [appts, setAppts] = useState<TaskLite[]>([]);
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  // Editable contact
  const [form, setForm] = useState({ name: '', companyName: '', mobilePhone: '', landlinePhone: '', email: '', address: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  // Note
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const refs = {
    contact: useRef<HTMLDivElement>(null),
    offers: useRef<HTMLDivElement>(null),
    appointments: useRef<HTMLDivElement>(null),
    files: useRef<HTMLDivElement>(null),
    calls: useRef<HTMLDivElement>(null),
  };

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const supabase = createBrowserSupabaseClient();
      const [cRes, oRes, tRes, sRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`, { headers }),
        fetch(`/api/offers?customerId=${encodeURIComponent(customerId)}&limit=50`, { headers }),
        fetch(`/api/tasks?customerId=${encodeURIComponent(customerId)}&limit=100`, { headers }),
        supabase.from('customer_upload_sessions').select('id, files, uploaded_at').eq('customer_id', customerId).order('uploaded_at', { ascending: false }).limit(20),
      ]);
      const c = await cRes.json().catch(() => ({}));
      const o = await oRes.json().catch(() => ({}));
      const t = await tRes.json().catch(() => ({}));
      if (c?.ok && c.customer) {
        const cust = c.customer as CustomerFull;
        setCustomer(cust);
        setForm({
          name: cust.name ?? '', companyName: cust.companyName ?? '', mobilePhone: cust.mobilePhone ?? '',
          landlinePhone: cust.landlinePhone ?? '', email: cust.email ?? '', address: cust.address ?? '',
        });
        setNoteDraft(cust.notes ?? '');
      }
      if (o?.ok && Array.isArray(o.offers)) setOffers(o.offers as OfferLite[]);
      if (t?.ok && Array.isArray(t.tasks)) setAppts((t.tasks as TaskLite[]).filter((x) => APPT_TYPES.has(x.type)));
      if (sRes && !sRes.error && Array.isArray(sRes.data)) setSessions(sRes.data as unknown as UploadSession[]);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [customerId]);

  useEffect(() => { if (open) { setLoading(true); setContactSaved(false); setNoteSaved(false); void load(); } }, [open, load]);

  // Scroll to the requested section / open the gallery once loaded.
  useEffect(() => {
    if (!open || loading) return;
    if (autoOpenGallery) { const id = window.setTimeout(() => setGalleryOpen(true), 50); return () => window.clearTimeout(id); }
    if (initialSection) {
      const id = window.setTimeout(() => refs[initialSection].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
      return () => window.clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, initialSection, autoOpenGallery]);

  const galleryFiles = useMemo<GalleryFile[]>(() => {
    const out: GalleryFile[] = [];
    for (const s of sessions) (s.files ?? []).forEach((f, idx) => out.push({
      sessionId: s.id, fileIndex: idx, name: f.name,
      kind: f.kind === 'photo' ? 'image' : f.kind === 'video' ? 'video' : 'file', mimeType: f.mimeType,
    }));
    return out;
  }, [sessions]);

  const resolveGalleryUrl = useCallback(async (file: GalleryFile): Promise<string | null> => {
    try {
      const headers = await authHeaders(); if (!headers) return null;
      const res = await fetch(`/api/customers/${customerId}/files/signed-url`, { method: 'POST', headers, body: JSON.stringify({ sessionId: file.sessionId, fileIndex: file.fileIndex }) });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; signedUrl?: string };
      return json.ok && json.signedUrl ? json.signedUrl : null;
    } catch { return null; }
  }, [customerId]);

  async function saveContact() {
    setSavingContact(true); setContactSaved(false);
    try {
      const headers = await authHeaders(); if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          name: form.name || null, companyName: form.companyName || null, mobilePhone: form.mobilePhone || null,
          landlinePhone: form.landlinePhone || null, email: form.email || null, address: form.address || null,
        }),
      });
      if (res.ok) { setContactSaved(true); setTimeout(() => setContactSaved(false), 2000); const j = await res.json().catch(() => ({})); if (j?.ok && j.customer) setCustomer(j.customer as CustomerFull); }
    } catch { /* non-fatal */ } finally { setSavingContact(false); }
  }
  async function saveNote() {
    setNoteSaving(true); setNoteSaved(false);
    try {
      const headers = await authHeaders(); if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, { method: 'PATCH', headers, body: JSON.stringify({ notes: noteDraft }) });
      if (res.ok) { setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2000); }
    } catch { /* non-fatal */ } finally { setNoteSaving(false); }
  }
  async function rejectCustomer() {
    if (!window.confirm('Να σημειωθεί ο πελάτης ως «Χαμένος»;')) return;
    setRejecting(true);
    try {
      const headers = await authHeaders(); if (!headers) return;
      await fetch(`/api/customers/${customerId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'lost' }) });
      onClose();
    } catch { /* non-fatal */ } finally { setRejecting(false); }
  }

  if (!open) return null;

  const name = customer?.name ?? customer?.companyName ?? 'Πελάτης';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30 motion-safe:animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-[#F5F5F7] shadow-2xl motion-safe:animate-[slideInRight_0.28s_cubic-bezier(0.32,0.72,0,1)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onClose} aria-label="Πίσω στη συνομιλία" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 transition active:scale-95 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          </button>
          <p className="flex-1 truncate text-base font-semibold text-zinc-900">{name}</p>
          {customer?.status && <Badge tone={STATUS_TONE[customer.status] ?? 'zinc'} className="shrink-0">{STATUS_GR[customer.status] ?? customer.status}</Badge>}
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">Φόρτωση…</span>
              <div className="motion-safe:animate-pulse"><SectionCardSkeleton /></div>
              <div className="motion-safe:animate-pulse"><SectionCardSkeleton /></div>
              <div className="motion-safe:animate-pulse"><SectionCardSkeleton /></div>
            </div>
          ) : (
            <>
              {/* Contact (editable) */}
              <div ref={refs.contact}>
                <SectionCard title="Στοιχεία επικοινωνίας">
                  <div className="space-y-3">
                    <Input label="Ονοματεπώνυμο" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    <Input label="Εταιρεία" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="Προαιρετικό" />
                    <div className="flex gap-2">
                      <Input label="Κινητό" value={form.mobilePhone} onChange={(e) => setForm((f) => ({ ...f, mobilePhone: e.target.value }))} inputMode="tel" className="tabular-nums" />
                      <Input label="Σταθερό" value={form.landlinePhone} onChange={(e) => setForm((f) => ({ ...f, landlinePhone: e.target.value }))} inputMode="tel" className="tabular-nums" />
                    </div>
                    <Input label="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} inputMode="email" />
                    <Input label="Διεύθυνση" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                    {form.address && (
                      <a href={buildMapsUrl(form.address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 transition active:scale-[0.98] hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                        <svg className="h-5 w-5 shrink-0" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                        Άνοιγμα στο Google Maps
                      </a>
                    )}
                    <div className="flex items-center justify-end gap-3 pt-1">
                      {contactSaved && <SavedCheck label="Αποθηκεύτηκε" />}
                      <Button size="md" loading={savingContact} onClick={saveContact}>Αποθήκευση στοιχείων</Button>
                    </div>
                  </div>
                </SectionCard>
              </div>

              {/* Offers */}
              <div ref={refs.offers}>
                <SectionCard title={`Προσφορές${offers.length ? ` (${offers.length})` : ''}`}>
                  {offers.length === 0 ? <Empty text="Δεν υπάρχουν προσφορές." /> : (
                    <div className="space-y-1.5">
                      {offers.map((o) => (
                        <div key={o.id} className="flex items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-900">{o.offerNumber ?? 'Προσφορά'}</p>
                            <p className="text-xs text-zinc-500">{fmtDate(o.offerDate)} · {OFFER_STATUS_GR[o.status] ?? o.status}</p>
                          </div>
                          {typeof o.total === 'number' && <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-800">€{o.total.toLocaleString('el-GR')}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Appointments */}
              <div ref={refs.appointments}>
                <SectionCard title={`Ραντεβού${appts.length ? ` (${appts.length})` : ''}`}>
                  {appts.length === 0 ? <Empty text="Δεν υπάρχουν ραντεβού." /> : (
                    <div className="space-y-1.5">
                      {appts.map((a) => (
                        <div key={a.id} className="rounded-xl bg-zinc-50 px-3 py-2">
                          <p className="text-sm font-medium text-zinc-900">{fmtDate(a.dueDate)}{a.dueTime ? ` · ${a.dueTime}` : ''}</p>
                          {(a.note || a.title) && <p className="truncate text-xs text-zinc-500">{a.note || a.title}</p>}
                          {a.status !== 'open' && <p className="text-[11px] text-zinc-500">{a.status === 'completed' ? 'Ολοκληρώθηκε' : a.status === 'cancelled' ? 'Ακυρώθηκε' : a.status}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Files / gallery */}
              <div ref={refs.files}>
                <SectionCard title={`Αρχεία${galleryFiles.length ? ` (${galleryFiles.length})` : ''}`}>
                  {galleryFiles.length === 0 ? <Empty text="Δεν υπάρχουν αρχεία." /> : (
                    <div className="grid grid-cols-4 gap-2">
                      {galleryFiles.map((f, i) => (
                        <button key={`${f.sessionId}:${f.fileIndex}`} type="button" onClick={() => { setGalleryIndex(i); setGalleryOpen(true); }} className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200/60 transition active:scale-95 hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2" aria-label={f.name}>
                          {f.kind === 'video' ? <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg> : <svg className="h-6 w-6" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M6 6h.008v.008H6V6Z" /></svg>}
                        </button>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Calls (AI briefs) */}
              <div ref={refs.calls}>
                <SectionCard title={`Κλήσεις${callBriefs.length ? ` (${callBriefs.length})` : ''}`}>
                  {callBriefs.length === 0 ? <Empty text="Δεν υπάρχουν κλήσεις με περίληψη." /> : (
                    <div className="space-y-3">
                      {callBriefs.map((b) => (
                        <div key={b.id} className="border-l-2 border-indigo-200 pl-3">
                          <p className="text-[11px] font-medium text-zinc-500">{fmtDate(b.occurredAt)}</p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{b.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Internal note */}
              <SectionCard title="Εσωτερική σημείωση">
                <Textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="Σημείωση ορατή μόνο σε εσένα…" />
                <div className="mt-3 flex items-center justify-end gap-3">
                  {noteSaved && <SavedCheck label="Αποθηκεύτηκε" />}
                  <Button size="md" loading={noteSaving} onClick={saveNote}>Αποθήκευση</Button>
                </div>
              </SectionCard>

              {/* Reject */}
              <Button variant="danger" fullWidth size="md" loading={rejecting} disabled={customer?.status === 'lost'} onClick={rejectCustomer}>
                <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                {customer?.status === 'lost' ? 'Πελάτης χαμένος' : 'Απόρριψη πελάτη'}
              </Button>
            </>
          )}
        </div>
      </div>

      <FileGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} files={galleryFiles} initialIndex={galleryIndex} resolveUrl={resolveGalleryUrl} />
    </div>
  );
}
