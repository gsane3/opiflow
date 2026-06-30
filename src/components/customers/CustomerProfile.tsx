'use client';

// Customer card = the prototype's ProfileScreen (screens-customer.jsx), ported
// 1:1 with the prototype's own CSS (opf-* on .opf-stage) and wired to the real
// customer APIs. Hero (avatar + name + status pill) · round actions (Κλήση /
// Μήνυμα / Νέο project / Χάρτης) · Έργα (the faithful projects section) ·
// Ιστορικό κλήσεων (tap a call → its brief) · internal note. Contact details are
// edited via the pencil (CustomerEditSheet). Rendered inside the app shell.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { buildMapsUrl } from '@/lib/maps';
import { OpfIcon } from '@/components/opf/icon';
import CustomerFoldersStrip from '@/components/customers/CustomerFoldersStrip';
import CustomerEditSheet from '@/components/customers/CustomerEditSheet';
import NextActionCard, { type NextActionType } from '@/components/customers/NextActionCard';

interface CustomerFull {
  id: string; name: string | null; companyName: string | null;
  phone: string | null; mobilePhone: string | null; landlinePhone: string | null;
  email: string | null; address: string | null; notes: string | null; status: string | null;
  blocked?: boolean;
}
interface TimelineItem {
  id: string; type: string; title: string; body: string | null; occurredAt: string; side: 'us' | 'customer';
  status?: string | null;
  payload?: { mark?: string | null; qrUrl?: string | null; totalAmount?: number | null; invoiceType?: string | null } | null;
}

function fmtCallTime(s: string): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return s; }
}

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
  const [calls, setCalls] = useState<TimelineItem[]>([]);
  // Official invoices (AADE/myDATA add-on) — derived from the same timeline feed.
  // Stays empty (section hidden) for tenants without the optional invoicing feature.
  const [invoices, setInvoices] = useState<TimelineItem[]>([]);
  const [expandedCall, setExpandedCall] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  // True once the profile has loaded at least once — lets a failed background
  // refresh keep the existing data instead of blanking to the error screen.
  const loadedRef = useRef(false);
  const [createSignal, setCreateSignal] = useState(0);
  const [naKey, setNaKey] = useState(0);
  const [infoOpen, setInfoOpen] = useState(false);
  const [msgSignal, setMsgSignal] = useState(0);
  const [note, setNote] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [intakeBusy, setIntakeBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const headers = await authHeaders();
      if (!headers) { setLoadErr(true); setLoading(false); return; }
      const [cRes, tRes] = await Promise.all([
        fetch(`/api/customers/${customerId}`, { headers }),
        fetch(`/api/customers/${customerId}/timeline`, { headers }),
      ]);
      const c = (await cRes.json().catch(() => ({}))) as { ok?: boolean; customer?: CustomerFull };
      if (cRes.ok && c?.ok && c.customer) { loadedRef.current = true; setCust(c.customer); setNote(c.customer.notes ?? ''); }
      // Only flag an error when we have NOTHING to show — a failed background
      // refresh must not blank an already-loaded profile.
      else if (!loadedRef.current) setLoadErr(true);
      const t = (await tRes.json().catch(() => ({}))) as { ok?: boolean; items?: TimelineItem[]; timeline?: TimelineItem[] };
      const items = t.items ?? t.timeline ?? [];
      // Call history — newest first; tap a call to reveal its brief/content.
      setCalls(items.filter((i) => i.type === 'call').reverse());
      // Issued official invoices — newest first.
      setInvoices(items.filter((i) => i.type === 'invoice').reverse());
      setNaKey((n) => n + 1); // re-evaluate the Next Best Action after a reload
    } catch { if (!loadedRef.current) setLoadErr(true); } finally { setLoading(false); }
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

  // «Ζήτα στοιχεία» (web parity with native): customer-level intake-link request.
  async function sendIntake() {
    if (!window.confirm('Θα σταλεί σύνδεσμος στον πελάτη (Viber → SMS) για να συμπληρώσει τα στοιχεία του. Συνέχεια;')) return;
    setIntakeBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}/intake-link`, { method: 'POST', headers, body: JSON.stringify({ mode: 'send' }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: boolean; reason?: string; fallbackReason?: string };
      if (res.ok && j.ok) {
        window.alert(j.sent === false ? `Ετοιμάστηκε ο σύνδεσμος (δεν στάλθηκε αυτόματα: ${j.reason ?? j.fallbackReason ?? '—'}).` : 'Ο σύνδεσμος στάλθηκε στον πελάτη.');
      } else {
        window.alert('Δεν ήταν δυνατή η αποστολή. Δοκίμασε ξανά.');
      }
    } catch { window.alert('Σφάλμα σύνδεσης.'); } finally { setIntakeBusy(false); }
  }

  // «Απόρριψη πελάτη» — mark status=lost (web parity with native).
  async function rejectCustomer() {
    if ((cust?.status ?? 'new') === 'lost') return;
    if (!window.confirm('Να σημανθεί ο πελάτης ως «Χαμένος»;')) return;
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'lost' }) });
      if (res.ok) void load();
      else window.alert('Δεν ήταν δυνατή η ενημέρωση.');
    } catch { window.alert('Σφάλμα σύνδεσης.'); }
  }

  // «Διαγραφή επαφής» — permanently delete this contact (any contact, imported
  // or not). Child rows cascade/null at the DB level. Returns to the list.
  async function deleteContact() {
    const label = cust?.name?.trim() || 'αυτή την επαφή';
    if (!window.confirm(`Οριστική διαγραφή «${label}»; Η ενέργεια δεν αναιρείται.`)) return;
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, { method: 'DELETE', headers });
      if (res.ok) router.push('/customers');
      else window.alert('Δεν ήταν δυνατή η διαγραφή.');
    } catch { window.alert('Σφάλμα σύνδεσης.'); }
  }

  // «Αποκλεισμός» — block/unblock the contact's inbound calls (migration 058).
  async function toggleBlocked() {
    const next = !cust?.blocked;
    const ok = window.confirm(
      next
        ? 'Αποκλεισμός κλήσεων από αυτή την επαφή; Οι κλήσεις της θα απορρίπτονται.'
        : 'Άρση αποκλεισμού; Οι κλήσεις θα ξαναχτυπούν κανονικά.'
    );
    if (!ok) return;
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, { method: 'PATCH', headers, body: JSON.stringify({ blocked: next }) });
      if (res.ok) void load();
      else window.alert('Δεν ήταν δυνατή η ενημέρωση.');
    } catch { window.alert('Σφάλμα σύνδεσης.'); }
  }

  // «Εκτέλεση» on the customer-scope card. The ranker only emits create_work_folder
  // here (no folder yet) → open the existing «Νέο έργο» sheet. Never auto-sends.
  function onNextAction(t: NextActionType) {
    if (t === 'create_work_folder') setCreateSignal((n) => n + 1);
  }

  // No customer yet → show an explicit loading or error/not-found state instead
  // of a blank «Πελάτης» hero (which read as a real, empty customer before).
  if (!cust) {
    return (
      <div className="opf-stage" data-theme={theme} style={{ minHeight: '100%', background: 'var(--bg)' }}>
        <div className="opf-topbar opf-prof-top">
          <button className="opf-press opf-tb-back" onClick={() => router.push('/customers')} aria-label="Πίσω"><OpfIcon name="chevronL" size={24} color="var(--brand)" stroke={2.4} /></button>
          <div style={{ flex: 1 }} />
        </div>
        <div style={{ padding: '48px 16px', textAlign: 'center' }}>
          {loading ? (
            <div className="opf-empty-card">Φόρτωση πελάτη…</div>
          ) : (
            <div className="opf-empty-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
              <span>{loadErr ? 'Δεν φορτώθηκε ο πελάτης. Ίσως έληξε η σύνδεση ή ο πελάτης δεν υπάρχει.' : 'Ο πελάτης δεν βρέθηκε.'}</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="opf-btn-primary opf-press" onClick={() => { setLoading(true); void load(); }} style={{ padding: '10px 18px', borderRadius: 12 }}>Δοκίμασε ξανά</button>
                <button className="opf-press" onClick={() => router.push('/customers')} style={{ padding: '10px 18px', borderRadius: 12, fontWeight: 700, color: 'var(--muted)' }}>Πίσω</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const name = cust.name ?? cust.companyName ?? 'Πελάτης';
  const initial = name.trim()[0]?.toUpperCase() ?? '?';
  const phone = cust.mobilePhone || cust.phone || cust.landlinePhone || '';
  const status = cust.status ?? 'new';

  return (
    <div className="opf-stage" data-theme={theme} style={{ minHeight: '100%', background: 'var(--bg)' }}>
      {/* top bar */}
      <div className="opf-topbar opf-prof-top">
        <button className="opf-press opf-tb-back" onClick={() => router.push('/customers')} aria-label="Πίσω"><OpfIcon name="chevronL" size={24} color="var(--brand)" stroke={2.4} /></button>
        <div style={{ flex: 1 }} />
        <button className="opf-g-round opf-press" onClick={() => setInfoOpen(true)} aria-label="Επεξεργασία στοιχείων"><OpfIcon name="edit" size={18} color="var(--brand)" stroke={2} /></button>
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
          <button className="opf-round-act opf-press" onClick={() => setMsgSignal((n) => n + 1)}>
            <div className="opf-round-circle"><OpfIcon name="message" size={22} color="var(--brand)" stroke={2} /></div>
            <span style={{ color: 'var(--ink-2)' }}>Μήνυμα</span>
          </button>
          <button className="opf-round-act opf-press" onClick={() => setCreateSignal((n) => n + 1)}>
            <div className="opf-round-circle"><OpfIcon name="folderPlus" size={22} color="var(--brand)" stroke={2} /></div>
            <span style={{ color: 'var(--ink-2)' }}>Νέο έργο</span>
          </button>
          <button className="opf-round-act opf-press" onClick={() => void sendIntake()} disabled={intakeBusy}>
            <div className="opf-round-circle"><OpfIcon name="clipboard" size={22} color="var(--brand)" stroke={2} /></div>
            <span style={{ color: 'var(--ink-2)' }}>Ζήτα στοιχεία</span>
          </button>
          <button className={'opf-round-act opf-press' + (cust?.address ? '' : ' opf-off')} onClick={() => cust?.address && window.open(buildMapsUrl(cust.address), '_blank')}>
            <div className="opf-round-circle"><OpfIcon name="map" size={22} color={cust?.address ? 'var(--brand)' : 'var(--muted)'} stroke={2} /></div>
            <span style={{ color: cust?.address ? 'var(--ink-2)' : 'var(--muted)' }}>Χάρτης</span>
          </button>
        </div>

        {/* Single Next Best Action — shown only while the customer has no έργο yet
            (the endpoint returns null once a folder exists; the folder card takes over). */}
        <div style={{ padding: '0 16px' }}>
          <NextActionCard endpoint={`/api/customers/${customerId}/next-action`} refreshKey={naKey} onExecute={onNextAction} />
        </div>

        {/* Έργα — the faithful projects section */}
        <CustomerFoldersStrip customerId={customerId} onChanged={() => void load()} openCreateSignal={createSignal} openLatestSignal={msgSignal} />

        {/* Ιστορικό κλήσεων — tap a call to reveal its brief/content */}
        <div className="opf-sec-title"><div className="opf-sec-title-l"><OpfIcon name="phone" size={19} color="var(--brand)" /> <span>Ιστορικό κλήσεων</span></div></div>
        {calls.length === 0 && !loading ? (
          <div className="opf-empty-card">Δεν υπάρχουν κλήσεις ακόμα.</div>
        ) : (
          calls.map((cl) => {
            const open = expandedCall === cl.id;
            return (
              <button
                key={cl.id}
                className="opf-card opf-press"
                onClick={() => setExpandedCall(open ? null : cl.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: 14 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <OpfIcon name="phone" size={20} color="var(--brand)" stroke={2} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{cl.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtCallTime(cl.occurredAt)}</div>
                  </div>
                  <OpfIcon name={open ? 'chevronD' : 'chevronR'} size={18} color="var(--muted)" stroke={2} />
                </div>
                {open && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                    {cl.body?.trim() ? cl.body : 'Δεν υπάρχει περιεχόμενο για αυτή την κλήση.'}
                  </div>
                )}
              </button>
            );
          })
        )}

        {/* Τιμολόγια — issued official invoices/receipts (AADE/myDATA). Hidden
            entirely unless the optional invoicing add-on has produced documents. */}
        {invoices.length > 0 && (
          <>
            <div className="opf-sec-title"><div className="opf-sec-title-l"><OpfIcon name="file" size={19} color="var(--brand)" /> <span>Τιμολόγια</span></div></div>
            {invoices.map((inv) => {
              const mark = inv.payload?.mark ?? null;
              const qrUrl = inv.payload?.qrUrl ?? null;
              const total = typeof inv.payload?.totalAmount === 'number'
                ? `€${inv.payload.totalAmount.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : (inv.body ?? null);
              return (
                <div key={inv.id} className="opf-card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <OpfIcon name="file" size={20} color="var(--brand)" stroke={2} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{inv.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtCallTime(inv.occurredAt)}</div>
                    </div>
                    {total ? <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{total}</div> : null}
                  </div>
                  {mark ? (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ΜΑΡΚ: {mark}</div>
                      {qrUrl ? (
                        <a href={qrUrl} target="_blank" rel="noopener noreferrer" className="opf-press" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--brand)', flexShrink: 0 }}>
                          <OpfIcon name="link" size={15} color="var(--brand)" stroke={2} /> myDATA
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </>
        )}

        {/* Internal note */}
        <div className="opf-sec-title"><div className="opf-sec-title-l"><span>Εσωτερική σημείωση</span></div></div>
        <div className="opf-card opf-note-card">
          <textarea className="opf-ta" placeholder="Σημείωση ορατή μόνο σε εσένα…" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="opf-btn-primary opf-full opf-press" onClick={() => void saveNote()}>{noteSaving ? 'Αποθήκευση…' : noteSaved ? 'Αποθηκεύτηκε ✓' : 'Αποθήκευση σημείωσης'}</button>
        </div>

        {/* Block / unblock inbound calls */}
        <button
          className="opf-press"
          onClick={() => void toggleBlocked()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 14, padding: '12px', borderRadius: 14, background: 'transparent', color: 'var(--danger)', fontWeight: 700, fontSize: 14 }}
        >
          <OpfIcon name="x" size={17} color="var(--danger)" stroke={2.4} /> {cust?.blocked ? 'Άρση αποκλεισμού' : 'Αποκλεισμός κλήσεων'}
        </button>

        {/* Reject / mark-lost (web parity with native) */}
        {status !== 'lost' && (
          <button
            className="opf-press"
            onClick={() => void rejectCustomer()}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 14, padding: '12px', borderRadius: 14, background: 'transparent', color: 'var(--danger)', fontWeight: 700, fontSize: 14 }}
          >
            <OpfIcon name="x" size={17} color="var(--danger)" stroke={2.4} /> Απόρριψη πελάτη
          </button>
        )}

        {/* Permanent delete — removes the contact entirely (works for any contact). */}
        <button
          className="opf-press"
          onClick={() => void deleteContact()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 4, padding: '12px', borderRadius: 14, background: 'transparent', color: 'var(--danger)', fontWeight: 700, fontSize: 14 }}
        >
          <OpfIcon name="trash" size={17} color="var(--danger)" stroke={2.4} /> Διαγραφή επαφής
        </button>
      </div>

      {/* Edit-details popup — opened by the pencil; re-loads the profile on save. */}
      <CustomerEditSheet customerId={customerId} open={infoOpen} onClose={() => setInfoOpen(false)} onSaved={() => void load()} />
    </div>
  );
}
