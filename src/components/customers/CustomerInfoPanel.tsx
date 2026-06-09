'use client';

// Customer info slide-over (redesign P3c). Opened from the ⓘ button in the
// Messenger chat header. Everything about the customer lives here in sections —
// NO redirect to an old card:
//   identity + status · contact (tel:/mailto: + Google Maps) · aggregated offers ·
//   AI call-brief timeline · media gallery (customer photos/videos) ·
//   editable internal note · reject customer.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { buildMapsUrl } from '@/lib/maps';
import FileGallery, { type GalleryFile } from './FileGallery';

interface CustomerFull {
  id: string;
  name: string | null;
  companyName: string | null;
  crmNumber: string | null;
  phone: string | null;
  mobilePhone: string | null;
  landlinePhone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: string | null;
  opportunityValue: number | null;
}

interface OffersSummary {
  offerCount: number;
  totalValue: number;
  acceptedCount: number;
  pendingCount: number;
  latestStatus: string | null;
  latestOfferDate: string | null;
}

interface UploadFile { name: string; kind?: string; mimeType?: string }
interface UploadSession { id: string; file_count: number | null; files: UploadFile[] | null; uploaded_at: string }

export interface BriefEntry {
  id: string;
  title: string;
  body: string;
  occurredAt: string;
}

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

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

const STATUS_GR: Record<string, string> = { new: 'Νέος', in_progress: 'Σε εξέλιξη', won: 'Κερδισμένος', lost: 'Χαμένος' };

export default function CustomerInfoPanel({
  customerId,
  open,
  onClose,
  callBriefs,
}: {
  customerId: string;
  open: boolean;
  onClose: () => void;
  callBriefs: BriefEntry[];
}) {
  const [customer, setCustomer] = useState<CustomerFull | null>(null);
  const [offers, setOffers] = useState<OffersSummary | null>(null);
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    const headers = await authHeaders();
    if (!headers) { setLoading(false); return; }
    try {
      const supabase = createBrowserSupabaseClient();
      const [cRes, oRes, sRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`, { headers }),
        fetch(`/api/customers/${customerId}/offers/summary`, { headers }),
        supabase
          .from('customer_upload_sessions')
          .select('id, file_count, files, uploaded_at')
          .eq('customer_id', customerId)
          .order('uploaded_at', { ascending: false })
          .limit(20),
      ]);
      const c = await cRes.json().catch(() => ({}));
      const o = await oRes.json().catch(() => ({}));
      if (c?.ok && c.customer) {
        setCustomer(c.customer as CustomerFull);
        setNoteDraft((c.customer as CustomerFull).notes ?? '');
      }
      if (o?.ok && o.summary) setOffers(o.summary as OffersSummary);
      if (sRes && !sRes.error && Array.isArray(sRes.data)) {
        setSessions(sRes.data as unknown as UploadSession[]);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (open) { setLoading(true); setNoteSaved(false); void load(); }
  }, [open, load]);

  const galleryFiles = useMemo<GalleryFile[]>(() => {
    const out: GalleryFile[] = [];
    for (const s of sessions) {
      (s.files ?? []).forEach((f, idx) => {
        out.push({
          sessionId: s.id,
          fileIndex: idx,
          name: f.name,
          kind: f.kind === 'photo' ? 'image' : f.kind === 'video' ? 'video' : 'file',
          mimeType: f.mimeType,
        });
      });
    }
    return out;
  }, [sessions]);

  const resolveGalleryUrl = useCallback(async (file: GalleryFile): Promise<string | null> => {
    try {
      const headers = await authHeaders();
      if (!headers) return null;
      const res = await fetch(`/api/customers/${customerId}/files/signed-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ sessionId: file.sessionId, fileIndex: file.fileIndex }),
      });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; signedUrl?: string };
      return json.ok && json.signedUrl ? json.signedUrl : null;
    } catch {
      return null;
    }
  }, [customerId]);

  async function saveNote() {
    setNoteSaving(true);
    setNoteSaved(false);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ notes: noteDraft }),
      });
      if (res.ok) { setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2000); }
    } catch {
      /* non-fatal */
    } finally {
      setNoteSaving(false);
    }
  }

  async function rejectCustomer() {
    if (!window.confirm('Να σημειωθεί ο πελάτης ως «Χαμένος»;')) return;
    setRejecting(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ status: 'lost' }),
      });
      onClose();
    } catch {
      /* non-fatal */
    } finally {
      setRejecting(false);
    }
  }

  if (!open) return null;

  const name = customer?.name ?? customer?.companyName ?? 'Πελάτης';
  const phones = [
    customer?.mobilePhone && { label: 'Κινητό', value: customer.mobilePhone },
    customer?.landlinePhone && { label: 'Σταθερό', value: customer.landlinePhone },
    !customer?.mobilePhone && !customer?.landlinePhone && customer?.phone && { label: 'Τηλέφωνο', value: customer.phone },
  ].filter(Boolean) as { label: string; value: string }[];
  const noteDirty = (customer?.notes ?? '') !== noteDraft;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" aria-label="Κλείσιμο" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col bg-[#F5F5F7] shadow-2xl">
        {/* Header */}
        <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3">
          <button type="button" onClick={onClose} aria-label="Πίσω στη συνομιλία" className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100">
            <svg className="h-5 w-5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          </button>
          <p className="flex-1 text-base font-semibold text-zinc-900">Στοιχεία πελάτη</p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-zinc-400">Φόρτωση…</p>
          ) : (
            <>
              {/* Identity */}
              <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700">{name.slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-zinc-900">{name}</p>
                    <p className="text-xs text-zinc-500">
                      {customer?.crmNumber ? `${customer.crmNumber} · ` : ''}{customer?.status ? (STATUS_GR[customer.status] ?? customer.status) : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div className="space-y-2 rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Επικοινωνία</p>
                {phones.map((p) => (
                  <a key={p.value} href={`tel:${p.value}`} className="flex items-center justify-between text-sm text-zinc-800">
                    <span className="text-zinc-500">{p.label}</span><span className="font-medium text-indigo-600">{p.value}</span>
                  </a>
                ))}
                {customer?.email && (
                  <a href={`mailto:${customer.email}`} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Email</span><span className="truncate font-medium text-indigo-600">{customer.email}</span>
                  </a>
                )}
                {customer?.address && (
                  <a href={buildMapsUrl(customer.address)} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700">
                    <svg className="h-4 w-4 shrink-0" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                    <span className="truncate">{customer.address}</span>
                  </a>
                )}
                {phones.length === 0 && !customer?.email && !customer?.address && (
                  <p className="text-sm text-zinc-400">Χωρίς στοιχεία επικοινωνίας.</p>
                )}
              </div>

              {/* Offers summary */}
              {offers && offers.offerCount > 0 && (
                <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Προσφορές</p>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-lg font-bold text-zinc-900">{offers.offerCount}</p><p className="text-[11px] text-zinc-500">Σύνολο</p></div>
                    <div><p className="text-lg font-bold text-green-600">{offers.acceptedCount}</p><p className="text-[11px] text-zinc-500">Αποδεκτές</p></div>
                    <div><p className="text-lg font-bold text-amber-600">{offers.pendingCount}</p><p className="text-[11px] text-zinc-500">Εκκρεμούν</p></div>
                  </div>
                  <p className="mt-2 text-center text-sm font-semibold text-zinc-800">€{offers.totalValue.toLocaleString('el-GR')}</p>
                </div>
              )}

              {/* Media gallery */}
              {galleryFiles.length > 0 && (
                <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Αρχεία πελάτη ({galleryFiles.length})</p>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {galleryFiles.map((f, i) => (
                      <button
                        key={`${f.sessionId}:${f.fileIndex}`}
                        type="button"
                        onClick={() => { setGalleryIndex(i); setGalleryOpen(true); }}
                        className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-zinc-100 text-zinc-400 ring-1 ring-zinc-200 transition hover:ring-indigo-300"
                        aria-label={f.name}
                      >
                        {f.kind === 'video' ? (
                          <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        ) : (
                          <svg className="h-6 w-6" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M6 6h.008v.008H6V6Z" /></svg>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Brief timeline */}
              {callBriefs.length > 0 && (
                <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ιστορικό κλήσεων (AI)</p>
                  <div className="mt-2 space-y-3">
                    {callBriefs.map((b) => (
                      <div key={b.id} className="border-l-2 border-indigo-200 pl-3">
                        <p className="text-[11px] font-medium text-zinc-400">{fmtDate(b.occurredAt)}</p>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">{b.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Internal note (editable) */}
              <div className="rounded-[24px] bg-white p-4 shadow-sm ring-1 ring-zinc-200/60">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Εσωτερική σημείωση</p>
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={3}
                  placeholder="Σημείωση ορατή μόνο σε εσένα…"
                  className="mt-2 w-full resize-y rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-400"
                />
                <div className="mt-2 flex items-center justify-end gap-2">
                  {noteSaved && <span className="text-xs font-medium text-green-600">Αποθηκεύτηκε ✓</span>}
                  <button
                    type="button"
                    onClick={saveNote}
                    disabled={noteSaving || !noteDirty}
                    className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {noteSaving ? 'Αποθήκευση…' : 'Αποθήκευση'}
                  </button>
                </div>
              </div>

              {/* Reject */}
              <button
                type="button"
                onClick={rejectCustomer}
                disabled={rejecting || customer?.status === 'lost'}
                className="flex w-full items-center justify-center gap-2 rounded-[24px] bg-white px-4 py-3 text-sm font-semibold text-red-600 shadow-sm ring-1 ring-red-100 transition hover:bg-red-50 disabled:opacity-40"
              >
                <svg className="h-5 w-5" fill="none" strokeWidth={1.6} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                {customer?.status === 'lost' ? 'Πελάτης χαμένος' : 'Απόρριψη πελάτη'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Full-screen media lightbox */}
      <FileGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        files={galleryFiles}
        initialIndex={galleryIndex}
        resolveUrl={resolveGalleryUrl}
      />
    </div>
  );
}
