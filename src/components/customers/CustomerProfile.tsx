'use client';

// Customer card = the prototype's ProfileScreen (screens-customer.jsx), ported
// 1:1 with the prototype's own CSS (opf-* on .opf-stage) and wired to the real
// customer APIs. Hero (avatar + name + status pill) · round actions (Κλήση /
// Μήνυμα / Νέο project / Χάρτης) · AI call-brief card · Έργα (the faithful
// projects section) · Στοιχεία · internal note. Rendered inside the app shell.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { buildMapsUrl } from '@/lib/maps';
import { OpfIcon } from '@/components/opf/icon';
import CustomerFoldersStrip from '@/components/customers/CustomerFoldersStrip';

interface CustomerFull {
  id: string; name: string | null; companyName: string | null;
  phone: string | null; mobilePhone: string | null; landlinePhone: string | null;
  email: string | null; address: string | null; notes: string | null; status: string | null;
}
interface TimelineItem { type: string; body: string | null; occurredAt: string }

const STATUS_LABEL: Record<string, string> = { new: 'Νέος', in_progress: 'Σε εξέλιξη', won: 'Κερδισμένος', lost: 'Χαμένος' };
const STATUS_PILL: Record<string, string> = { in_progress: 'opf-s-progress', won: 'opf-s-won', lost: 'opf-s-lost' };

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}

export default function CustomerProfile({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [theme] = useState<'light' | 'dark'>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [cust, setCust] = useState<CustomerFull | null>(null);
  const [brief, setBrief] = useState<{ body: string; when: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [createSignal, setCreateSignal] = useState(0);
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers) { setLoading(false); return; }
      const [cRes, tRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`, { headers }),
        fetch(`/api/customers/${customerId}/timeline`, { headers }),
      ]);
      const c = (await cRes.json().catch(() => ({}))) as { ok?: boolean; customer?: CustomerFull };
      if (c?.ok && c.customer) { setCust(c.customer); setNote(c.customer.notes ?? ''); }
      const t = (await tRes.json().catch(() => ({}))) as { ok?: boolean; items?: TimelineItem[]; timeline?: TimelineItem[] };
      const items = t.items ?? t.timeline ?? [];
      const calls = items.filter((i) => i.type === 'call' && (i.body ?? '').trim());
      const last = calls[calls.length - 1];
      if (last) setBrief({ body: (last.body ?? '').trim(), when: last.occurredAt });
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [customerId]);
  useEffect(() => { void load(); }, [load]);

  async function saveNote() {
    setNoteSaving(true); setNoteSaved(false);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, { method: 'PATCH', headers, body: JSON.stringify({ notes: note }) });
      if (res.ok) { setNoteSaved(true); setTimeout(() => setNoteSaved(false), 2000); }
    } catch { /* non-fatal */ } finally { setNoteSaving(false); }
  }

  const name = cust?.name ?? cust?.companyName ?? 'Πελάτης';
  const initial = name.trim()[0]?.toUpperCase() ?? '?';
  const phone = cust?.mobilePhone || cust?.phone || cust?.landlinePhone || '';
  const status = cust?.status ?? 'new';

  return (
    <div className="opf-stage" data-theme={theme} style={{ minHeight: '100%', background: 'var(--bg)' }}>
      {/* top bar */}
      <div className="opf-topbar opf-prof-top">
        <button className="opf-press opf-tb-back" onClick={() => router.push('/customers')} aria-label="Πίσω"><OpfIcon name="chevronL" size={24} color="var(--brand)" stroke={2.4} /></button>
        <div style={{ flex: 1 }} />
        <button className="opf-g-round opf-press" onClick={() => router.push(`/customers/${customerId}/chat`)} aria-label="Επεξεργασία"><OpfIcon name="edit" size={18} color="var(--brand)" stroke={2} /></button>
      </div>

      <div style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}>
        {/* hero */}
        <div className="opf-prof-hero">
          <div className="opf-avatar" style={{ width: 92, height: 92, fontSize: 38 }}><span>{initial}</span></div>
          <div className="opf-prof-name">{name}</div>
          <div className={`opf-status-pill ${STATUS_PILL[status] ?? ''}`}>{STATUS_LABEL[status] ?? 'Νέος'}</div>
        </div>

        {/* round actions */}
        <div className="opf-round-acts">
          <button className={'opf-round-act opf-press' + (phone ? '' : ' opf-off')} onClick={() => phone && router.push(`/calls?num=${encodeURIComponent(phone)}`)}>
            <div className="opf-round-circle"><OpfIcon name="phone" size={22} color={phone ? 'var(--brand)' : 'var(--muted)'} stroke={2} /></div>
            <span style={{ color: phone ? 'var(--ink-2)' : 'var(--muted)' }}>Κλήση</span>
          </button>
          <button className="opf-round-act opf-press" onClick={() => router.push(`/customers/${customerId}/chat`)}>
            <div className="opf-round-circle"><OpfIcon name="message" size={22} color="var(--brand)" stroke={2} /></div>
            <span style={{ color: 'var(--ink-2)' }}>Μήνυμα</span>
          </button>
          <button className="opf-round-act opf-press" onClick={() => setCreateSignal((n) => n + 1)}>
            <div className="opf-round-circle"><OpfIcon name="folderPlus" size={22} color="var(--brand)" stroke={2} /></div>
            <span style={{ color: 'var(--ink-2)' }}>Νέο έργο</span>
          </button>
          <button className={'opf-round-act opf-press' + (cust?.address ? '' : ' opf-off')} onClick={() => cust?.address && window.open(buildMapsUrl(cust.address), '_blank')}>
            <div className="opf-round-circle"><OpfIcon name="map" size={22} color={cust?.address ? 'var(--brand)' : 'var(--muted)'} stroke={2} /></div>
            <span style={{ color: cust?.address ? 'var(--ink-2)' : 'var(--muted)' }}>Χάρτης</span>
          </button>
        </div>

        {/* AI call brief */}
        {brief && (
          <div className="opf-card opf-brief-card">
            <div className="opf-brief-head"><OpfIcon name="sparkles" size={17} color="#fff" stroke={2.1} /> Σύνοψη κλήσης <span className="opf-brief-ai">AI</span></div>
            <div className="opf-brief-text" style={{ paddingBottom: 16 }}>{brief.body}</div>
          </div>
        )}

        {/* Έργα — the faithful projects section */}
        <CustomerFoldersStrip customerId={customerId} onChanged={() => void load()} openCreateSignal={createSignal} />

        {/* Στοιχεία */}
        <div className="opf-sec-title"><div className="opf-sec-title-l"><OpfIcon name="phone" size={19} color="var(--brand)" /> <span>Στοιχεία</span></div></div>
        {phone && (
          <button className="opf-card opf-detail-card opf-press" onClick={() => router.push(`/calls?num=${encodeURIComponent(phone)}`)} style={{ textAlign: 'left' }}>
            <div className="opf-detail-ic"><OpfIcon name="phone" size={20} color="var(--brand)" stroke={2} /></div>
            <div><div className="opf-detail-k">Τηλέφωνο</div><div className="opf-detail-v">{phone}</div></div>
          </button>
        )}
        {cust?.email && (
          <div className="opf-card opf-detail-card">
            <div className="opf-detail-ic"><OpfIcon name="mail" size={20} color="var(--brand)" stroke={2} /></div>
            <div><div className="opf-detail-k">Email</div><div className="opf-detail-v" style={{ wordBreak: 'break-all' }}>{cust.email}</div></div>
          </div>
        )}
        {cust?.address && (
          <a className="opf-card opf-detail-card opf-press" href={buildMapsUrl(cust.address)} target="_blank" rel="noopener noreferrer">
            <div className="opf-detail-ic"><OpfIcon name="map" size={20} color="var(--brand)" stroke={2} /></div>
            <div><div className="opf-detail-k">Διεύθυνση</div><div className="opf-detail-v">{cust.address}</div></div>
          </a>
        )}
        {!phone && !cust?.email && !cust?.address && !loading && (
          <div className="opf-empty-card">Δεν υπάρχουν στοιχεία ακόμα.</div>
        )}

        {/* Internal note */}
        <div className="opf-sec-title"><div className="opf-sec-title-l"><span>Εσωτερική σημείωση</span></div></div>
        <div className="opf-card opf-note-card">
          <textarea className="opf-ta" placeholder="Σημείωση ορατή μόνο σε εσένα…" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="opf-btn-primary opf-full opf-press" onClick={() => void saveNote()}>{noteSaving ? 'Αποθήκευση…' : noteSaved ? 'Αποθηκεύτηκε ✓' : 'Αποθήκευση σημείωσης'}</button>
        </div>
      </div>
    </div>
  );
}
