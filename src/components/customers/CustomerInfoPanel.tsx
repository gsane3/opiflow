'use client';

// Customer info slide-over (redesign P3c + feedback v2/v3). Opened from the ⓘ
// button in the Messenger chat. Sections are always visible (so placements are
// learnable), each with an empty state:
//   contact (collapsed → basics; full editable form on edit) · offers (tap →
//   preview) · appointments (tap → preview) · media gallery (image thumbnails) ·
//   call briefs · internal note · reject (review → Viber/SMS).
// `initialSection` opens the panel focused on a section (intake→contact opens it
// straight into edit). `autoOpenGallery` opens the lightbox (photo bubble tap).

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
import OfferPreviewSheet from './OfferPreviewSheet';
import AppointmentPreviewSheet, { type ApptLite } from './AppointmentPreviewSheet';
import { SendChannelSheet } from './SendChannelSheet';
import { useOverlayDismiss } from './useOverlayDismiss';

export type InfoSection = 'contact' | 'offers' | 'appointments' | 'files' | 'calls';

interface CustomerFull {
  id: string; name: string | null; companyName: string | null; crmNumber: string | null;
  phone: string | null; mobilePhone: string | null; landlinePhone: string | null;
  email: string | null; address: string | null; notes: string | null;
  status: string | null; opportunityValue: number | null;
  source: string | null; preferredContactMethod: string | null; needsSummary: string | null;
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

const CONTACT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'phone', label: 'Τηλέφωνο' }, { value: 'viber', label: 'Viber' },
  { value: 'sms', label: 'SMS' }, { value: 'email', label: 'Email' },
];
const SOURCES: Array<{ value: string; label: string }> = [
  { value: 'facebook_ads', label: 'Facebook Ads' }, { value: 'google_ads', label: 'Google Ads' },
  { value: 'website_form', label: 'Φόρμα ιστοσελίδας' }, { value: 'referral', label: 'Σύσταση' },
  { value: 'inbound_call', label: 'Εισερχόμενη κλήση' }, { value: 'missed_call', label: 'Χαμένη κλήση' },
  { value: 'manual_entry', label: 'Χειροκίνητη εισαγωγή' }, { value: 'other', label: 'Άλλο' },
];

// Polite default rejection message (kept identical to the old workspace flow).
const REJECT_MESSAGE = 'Καλησπέρα σας. Ευχαριστούμε πολύ για την επικοινωνία. Δυστυχώς δεν θα μπορέσουμε να αναλάβουμε τη συγκεκριμένη εργασία αυτή την περίοδο. Σας ευχόμαστε καλή συνέχεια και ελπίζουμε να βρείτε άμεσα την κατάλληλη λύση.';

function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[24px] bg-white dark:bg-[#17232f] p-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">{title}</p>
        {action}
      </div>
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
function SavedCheck({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 motion-safe:animate-[fadeIn_0.2s_ease-out]">
      <svg className="h-4 w-4" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
      {label}
    </span>
  );
}
function SectionCardSkeleton() {
  return (
    <div className="rounded-[24px] bg-white dark:bg-[#17232f] p-4 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10">
      <div className="h-3 w-28 rounded bg-zinc-200/80 dark:bg-[#1e2b38]" />
      <div className="mt-3 space-y-2"><div className="h-10 rounded-xl bg-zinc-100 dark:bg-[#1e2b38]" /><div className="h-10 w-3/4 rounded-xl bg-zinc-100 dark:bg-[#1e2b38]" /></div>
    </div>
  );
}

const FIELD_CLASS = 'w-full rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2.5 text-base text-zinc-900 dark:text-zinc-100 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

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
  // Contact
  const [editingContact, setEditingContact] = useState(false);
  const [form, setForm] = useState({ name: '', companyName: '', mobilePhone: '', landlinePhone: '', email: '', address: '', preferredContactMethod: 'phone', source: '', needsSummary: '' });
  const [savingContact, setSavingContact] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  // Note
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  // Preview sheets
  const [previewOfferId, setPreviewOfferId] = useState<string | null>(null);
  const [previewAppt, setPreviewAppt] = useState<ApptLite | null>(null);
  // Reject
  const [rejectOpen, setRejectOpen] = useState(false);
  const rejectAppliedRef = useRef(false);
  // Thumbnails (signed URLs for image files), keyed by `${sessionId}:${fileIndex}`.
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [thumbTick, setThumbTick] = useState(0); // bump to re-resolve expired/failed thumbs
  const thumbReqRef = useRef<Set<string>>(new Set());

  const refs = {
    contact: useRef<HTMLDivElement>(null),
    offers: useRef<HTMLDivElement>(null),
    appointments: useRef<HTMLDivElement>(null),
    files: useRef<HTMLDivElement>(null),
    calls: useRef<HTMLDivElement>(null),
  };

  const fillForm = useCallback((cust: CustomerFull) => {
    setForm({
      name: cust.name ?? '', companyName: cust.companyName ?? '', mobilePhone: cust.mobilePhone ?? '',
      landlinePhone: cust.landlinePhone ?? '', email: cust.email ?? '', address: cust.address ?? '',
      preferredContactMethod: cust.preferredContactMethod ?? 'phone', source: cust.source ?? '', needsSummary: cust.needsSummary ?? '',
    });
  }, []);

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
        fillForm(cust);
        setNoteDraft(cust.notes ?? '');
      }
      if (o?.ok && Array.isArray(o.offers)) setOffers(o.offers as OfferLite[]);
      if (t?.ok && Array.isArray(t.tasks)) setAppts((t.tasks as TaskLite[]).filter((x) => APPT_TYPES.has(x.type)));
      if (sRes && !sRes.error && Array.isArray(sRes.data)) setSessions(sRes.data as unknown as UploadSession[]);
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [customerId, fillForm]);

  useEffect(() => {
    if (open) {
      setLoading(true); setContactSaved(false); setNoteSaved(false);
      setEditingContact(initialSection === 'contact');
      rejectAppliedRef.current = false;
      thumbReqRef.current = new Set(); setThumbUrls({});
      void load();
    }
  }, [open, load, initialSection]);

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

  // Lazily resolve image thumbnails (cap a few dozen to stay light).
  useEffect(() => {
    if (!open || loading) return;
    let cancelled = false;
    const imgs = galleryFiles.filter((f) => f.kind === 'image').slice(0, 30);
    (async () => {
      for (const f of imgs) {
        const key = `${f.sessionId}:${f.fileIndex}`;
        if (thumbReqRef.current.has(key)) continue;
        thumbReqRef.current.add(key);
        const url = await resolveGalleryUrl(f);
        if (!cancelled && url) setThumbUrls((prev) => ({ ...prev, [key]: url }));
      }
    })();
    return () => { cancelled = true; };
  }, [open, loading, galleryFiles, resolveGalleryUrl, thumbTick]);

  // Re-resolve a thumbnail whose signed URL expired (300s TTL) or failed to load.
  function refreshThumb(key: string) {
    thumbReqRef.current.delete(key);
    setThumbUrls((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setThumbTick((t) => t + 1);
  }

  async function saveContact() {
    setSavingContact(true); setContactSaved(false);
    try {
      const headers = await authHeaders(); if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          name: form.name || null, companyName: form.companyName || null,
          mobilePhone: form.mobilePhone || null, phone: form.mobilePhone || null,
          landlinePhone: form.landlinePhone || null, email: form.email || null, address: form.address || null,
          preferredContactMethod: form.preferredContactMethod || 'phone',
          source: form.source || null, needsSummary: form.needsSummary || null,
        }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => ({}));
        if (j?.ok && j.customer) { setCustomer(j.customer as CustomerFull); fillForm(j.customer as CustomerFull); }
        setContactSaved(true); setEditingContact(false); setTimeout(() => setContactSaved(false), 2000);
      }
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
  // Mark the customer as lost exactly once (idempotent per open).
  async function markLost() {
    if (rejectAppliedRef.current) return;
    rejectAppliedRef.current = true;
    try {
      const headers = await authHeaders(); if (!headers) { rejectAppliedRef.current = false; return; }
      const res = await fetch(`/api/customers/${customerId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'lost' }) });
      const j = await res.json().catch(() => ({}));
      if (j?.ok && j.customer) setCustomer(j.customer as CustomerFull);
    } catch { rejectAppliedRef.current = false; }
  }

  useOverlayDismiss(open, onClose);

  if (!open) return null;

  const name = customer?.name ?? customer?.companyName ?? 'Πελάτης';

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30 motion-safe:animate-[fadeIn_0.2s_ease-out]" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-[#F5F5F7] dark:bg-[#0e1722] shadow-2xl motion-safe:animate-[slideInRight_0.28s_cubic-bezier(0.32,0.72,0,1)]">
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onClose} aria-label="Πίσω στη συνομιλία" className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-500 dark:text-zinc-400 transition active:scale-95 hover:bg-zinc-100 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          </button>
          <p className="flex-1 truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">{name}</p>
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
              {/* Contact — collapsed (basics) by default; full editable form on edit */}
              <div ref={refs.contact}>
                <SectionCard
                  title="Στοιχεία επικοινωνίας"
                  action={!editingContact ? (
                    <button type="button" onClick={() => setEditingContact(true)} className="rounded-full px-3 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                      Επεξεργασία
                    </button>
                  ) : undefined}
                >
                  {editingContact ? (
                    <div className="space-y-3">
                      <Input label="Ονοματεπώνυμο" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                      <Input label="Εταιρεία" value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} placeholder="Προαιρετικό" />
                      <div className="flex gap-2">
                        <Input label="Κινητό" value={form.mobilePhone} onChange={(e) => setForm((f) => ({ ...f, mobilePhone: e.target.value }))} inputMode="tel" className="tabular-nums" />
                        <Input label="Σταθερό" value={form.landlinePhone} onChange={(e) => setForm((f) => ({ ...f, landlinePhone: e.target.value }))} inputMode="tel" className="tabular-nums" />
                      </div>
                      <Input label="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} inputMode="email" />
                      <Input label="Διεύθυνση" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Προτιμώμενο κανάλι</label>
                        <select value={form.preferredContactMethod} onChange={(e) => setForm((f) => ({ ...f, preferredContactMethod: e.target.value }))} className={FIELD_CLASS}>
                          {CONTACT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Πηγή</label>
                        <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} className={FIELD_CLASS}>
                          <option value="">— Χωρίς πηγή —</option>
                          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                      <Textarea label="Ανάγκες πελάτη" value={form.needsSummary} onChange={(e) => setForm((f) => ({ ...f, needsSummary: e.target.value }))} rows={2} placeholder="Τι χρειάζεται ο πελάτης…" />
                      <div className="flex items-center justify-end gap-2 pt-1">
                        <Button variant="secondary" size="md" onClick={() => { setEditingContact(false); if (customer) fillForm(customer); }}>Ακύρωση</Button>
                        <Button size="md" loading={savingContact} onClick={saveContact}>Αποθήκευση</Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <dl className="space-y-2 text-sm">
                        {(form.mobilePhone || form.landlinePhone) && (
                          <div className="flex justify-between gap-2"><dt className="text-zinc-400 dark:text-zinc-500">{form.mobilePhone ? 'Κινητό' : 'Σταθερό'}</dt><dd className="font-medium tabular-nums text-zinc-800 dark:text-zinc-200">{form.mobilePhone || form.landlinePhone}</dd></div>
                        )}
                        {form.email && (<div className="flex justify-between gap-2"><dt className="shrink-0 text-zinc-400 dark:text-zinc-500">Email</dt><dd className="break-all font-medium text-zinc-800 dark:text-zinc-200">{form.email}</dd></div>)}
                        {form.companyName && (<div className="flex justify-between gap-2"><dt className="text-zinc-400 dark:text-zinc-500">Εταιρεία</dt><dd className="font-medium text-zinc-800 dark:text-zinc-200">{form.companyName}</dd></div>)}
                        {!form.mobilePhone && !form.landlinePhone && !form.email && !form.companyName && (
                          <p className="py-1 text-zinc-400 dark:text-zinc-500">Δεν υπάρχουν στοιχεία ακόμα. Πάτα «Επεξεργασία».</p>
                        )}
                      </dl>
                      {contactSaved && <div className="mt-2"><SavedCheck label="Αποθηκεύτηκε" /></div>}
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Google Maps — its own button, outside the contact card */}
              {form.address && (
                <a href={buildMapsUrl(form.address)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-[24px] bg-white dark:bg-[#17232f] px-4 py-3.5 text-sm font-semibold text-indigo-700 shadow-sm ring-1 ring-zinc-200/60 dark:ring-white/10 transition active:scale-[0.99] hover:bg-indigo-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50">
                    <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block">Άνοιγμα στο Google Maps</span>
                    <span className="block truncate text-xs font-normal text-zinc-400 dark:text-zinc-500">{form.address}</span>
                  </span>
                  <svg className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-500" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                </a>
              )}

              {/* Offers — clickable → preview */}
              <div ref={refs.offers}>
                <SectionCard title={`Προσφορές${offers.length ? ` (${offers.length})` : ''}`}>
                  {offers.length === 0 ? <Empty text="Δεν υπάρχουν προσφορές." /> : (
                    <div className="space-y-1.5">
                      {offers.map((o) => (
                        <button key={o.id} type="button" onClick={() => setPreviewOfferId(o.id)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 text-left ring-1 ring-transparent transition hover:bg-white dark:hover:bg-white/5 hover:ring-zinc-200 dark:hover:ring-white/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{o.offerNumber ?? 'Προσφορά'}</p>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">{fmtDate(o.offerDate)} · {OFFER_STATUS_GR[o.status] ?? o.status}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {typeof o.total === 'number' && <span className="text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">€{o.total.toLocaleString('el-GR')}</span>}
                            <svg className="h-4 w-4 text-zinc-300 dark:text-zinc-500" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Appointments — clickable → preview */}
              <div ref={refs.appointments}>
                <SectionCard title={`Ραντεβού${appts.length ? ` (${appts.length})` : ''}`}>
                  {appts.length === 0 ? <Empty text="Δεν υπάρχουν ραντεβού." /> : (
                    <div className="space-y-1.5">
                      {appts.map((a) => (
                        <button key={a.id} type="button" onClick={() => setPreviewAppt(a)} className="flex w-full items-center justify-between gap-2 rounded-xl bg-zinc-50 dark:bg-[#1e2b38] px-3 py-2.5 text-left ring-1 ring-transparent transition hover:bg-white dark:hover:bg-white/5 hover:ring-zinc-200 dark:hover:ring-white/10 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{fmtDate(a.dueDate)}{a.dueTime ? ` · ${a.dueTime}` : ''}</p>
                            {(a.note || a.title) && <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{a.note || a.title}</p>}
                          </div>
                          <svg className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-500" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                        </button>
                      ))}
                    </div>
                  )}
                </SectionCard>
              </div>

              {/* Files / gallery — image thumbnails */}
              <div ref={refs.files}>
                <SectionCard title={`Αρχεία${galleryFiles.length ? ` (${galleryFiles.length})` : ''}`}>
                  {galleryFiles.length === 0 ? <Empty text="Δεν υπάρχουν αρχεία." /> : (
                    <div className="grid grid-cols-4 gap-2">
                      {galleryFiles.map((f, i) => {
                        const key = `${f.sessionId}:${f.fileIndex}`;
                        const thumb = thumbUrls[key];
                        return (
                          <button key={key} type="button" onClick={() => { setGalleryIndex(i); setGalleryOpen(true); }} className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-zinc-100 dark:bg-[#1e2b38] text-zinc-400 dark:text-zinc-500 ring-1 ring-zinc-200/60 dark:ring-white/10 transition active:scale-95 hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2" aria-label={f.name}>
                            {f.kind === 'image' ? (
                              thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={thumb} alt={f.name} className="h-full w-full object-cover" draggable={false} onError={() => refreshThumb(key)} />
                              ) : (
                                // Image not yet resolved — a photo glyph (never the document icon).
                                <svg className="h-6 w-6" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M6 6h.008v.008H6V6Z" /></svg>
                              )
                            ) : f.kind === 'video' ? (
                              <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                            ) : (
                              <svg className="h-6 w-6" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
                            )}
                          </button>
                        );
                      })}
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
                          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{fmtDate(b.occurredAt)}</p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">{b.body}</p>
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

              {/* Reject → review text → Viber/SMS */}
              <Button variant="danger" fullWidth size="md" disabled={customer?.status === 'lost'} onClick={() => { rejectAppliedRef.current = false; setRejectOpen(true); }}>
                <svg className="h-5 w-5" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                {customer?.status === 'lost' ? 'Πελάτης χαμένος' : 'Απόρριψη πελάτη'}
              </Button>
            </>
          )}
        </div>
      </div>

      <FileGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} files={galleryFiles} initialIndex={galleryIndex} resolveUrl={resolveGalleryUrl} />

      <OfferPreviewSheet offerId={previewOfferId} open={previewOfferId !== null} onClose={() => setPreviewOfferId(null)} onChanged={() => void load()} />
      <AppointmentPreviewSheet appt={previewAppt} customerId={customerId} open={previewAppt !== null} onClose={() => setPreviewAppt(null)} />

      <SendChannelSheet
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Απόρριψη πελάτη"
        subtitle="Έλεγξε το μήνυμα και διάλεξε τρόπο αποστολής. Ο πελάτης σημειώνεται ως «Χαμένος» με την αποστολή."
        message={REJECT_MESSAGE}
        recipientPhone={customer?.mobilePhone || customer?.phone || null}
        recipientEmail={customer?.email || null}
        emailSubject="Σχετικά με το αίτημά σας"
        viber={{ kind: 'forward' }}
        onChannelUse={markLost}
      />
    </div>
  );
}
