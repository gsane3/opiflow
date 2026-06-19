'use client';

// Public customer portal — clean launcher port of the prototype (customer-page.jsx).
// No progress bar: a centred hero + a 4-tile launcher (Προσφορά · Ραντεβού ·
// Φωτογραφίες · Απορία) where each tile opens a bottom sheet, an «Ενημερώσεις» feed,
// and a social/contact footer. Tiles gate on real data: greyed «Δεν έχει σταλεί
// ακόμη» until the technician sends an offer/appointment, then an «Ελέγξτε» badge
// (with a pulse ring), then ✓ once the customer has handled it. The offer sheet
// folds in acceptance → payment (bank details + copy + «Δήλωσα την κατάθεση»), just
// like the technician side. All actions hit the existing folder-token-scoped
// /api/f/[token]/* endpoints (offer accept · appointment respond · payment declare ·
// message · upload-link).

import { useEffect, useRef, useState } from 'react';
import { OpfIcon, OpfLogo } from '@/components/opf/icon';
import type { PublicFolderView } from '@/lib/server/public-folder';

const KIND_GR: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };

function eur(n: number | null | undefined): string {
  return typeof n === 'number'
    ? `${n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : '—';
}
// «Τρί 17 Ιουν» (parsed as local date so YYYY-MM-DD doesn't shift a day).
function grDate(dateStr: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? '');
  if (!m) return dateStr ?? '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('el-GR', { weekday: 'short', day: 'numeric', month: 'short' });
}
// «09-06 18:05» feed timestamp.
function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const pad = (n: number) => String(n).padStart(2, '0');
function shift(date: string, time: string, deltaHours: number): { date: string; time: string } | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const base = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
  const d = new Date(base + deltaHours * 3600 * 1000);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}
// Normalize a stored social value (full URL or @handle/handle) to an href; only http(s) pass.
function socialHref(value: string | null | undefined, domain: string): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, '').replace(/^\/+/, '');
  return handle ? `https://${domain}/${handle}` : null;
}

type Offer = PublicFolderView['offers'][number];
type Appt = PublicFolderView['appointments'][number];
type Payment = PublicFolderView['payments'][number];
type Biz = PublicFolderView['business'];
type Msg = PublicFolderView['messages'][number];
type SheetKey = 'offer' | 'appt' | 'files' | 'chat' | null;

// ── bottom sheet ──────────────────────────────────────────────────────────────
function Sheet({
  open, onClose, title, children, footer,
}: {
  open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const [show, setShow] = useState(open);
  useEffect(() => { if (open) setShow(true); }, [open]);
  if (!show && !open) return null;
  return (
    <div className={'opf-sheet-wrap' + (open ? ' opf-open' : '')} onTransitionEnd={() => { if (!open) setShow(false); }}>
      <div className="opf-sheet-backdrop" onClick={onClose} />
      <div className="opf-sheet" role="dialog" aria-modal="true">
        <div className="opf-sheet-grab" />
        <div className="opf-sheet-head">
          <div className="opf-sheet-title">{title}</div>
          <button className="opf-sheet-x opf-press" onClick={onClose} aria-label="Κλείσιμο">
            <OpfIcon name="x" size={20} color="var(--muted)" stroke={2.2} />
          </button>
        </div>
        <div className="opf-sheet-body">{children}</div>
        {footer && <div className="opf-sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ── copy + bank rows ────────────────────────────────────────────────────────────
function CopyBtn({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); } catch { /* value stays visible to copy manually */ }
    setOk(true); setTimeout(() => setOk(false), 1400);
  }
  return (
    <button type="button" className={'opf-copy-btn opf-press' + (ok ? ' opf-ok' : '')} onClick={() => void copy()}>
      <OpfIcon name={ok ? 'check' : 'clipboard'} size={15} color={ok ? 'var(--success)' : 'var(--brand)'} stroke={2.2} />
      <span>{ok ? 'Αντιγράφηκε' : 'Αντιγραφή'}</span>
    </button>
  );
}
function BankRows({ beneficiary, bankName, iban }: { beneficiary: string | null; bankName: string | null; iban: string | null }) {
  return (
    <div className="opf-bank">
      {beneficiary && (
        <div className="opf-bank-row">
          <div className="opf-bank-info"><div className="opf-bank-k">Δικαιούχος</div><div className="opf-bank-v">{beneficiary}</div></div>
          <CopyBtn value={beneficiary} />
        </div>
      )}
      {bankName && (
        <div className="opf-bank-row">
          <div className="opf-bank-info"><div className="opf-bank-k">Τράπεζα</div><div className="opf-bank-v">{bankName}</div></div>
        </div>
      )}
      {iban && (
        <div className="opf-bank-row">
          <div className="opf-bank-info"><div className="opf-bank-k">IBAN</div><div className="opf-bank-v opf-mono">{iban}</div></div>
          <CopyBtn value={iban.replace(/\s/g, '')} />
        </div>
      )}
    </div>
  );
}

// ── payment block (inside the offer sheet, after acceptance) ─────────────────────
function PaymentBlock({ token, payment, biz }: { token: string; payment: Payment; biz: Biz }) {
  const [status, setStatus] = useState(payment.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function declare() {
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/payment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentRequestId: payment.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && j?.ok) setStatus('declared'); else setError(true);
    } catch { setError(true); } finally { setBusy(false); }
  }

  const beneficiary = biz?.bankBeneficiary ?? null;
  const showBank = status === 'pending' && (beneficiary || payment.receivingAccount);

  return (
    <div className="opf-portal-card opf-pay-card" style={{ margin: '12px 0 0' }}>
      <div className="opf-portal-card-h"><OpfIcon name="euro" size={18} color="var(--brand)" stroke={2} /> {KIND_GR[payment.kind] ?? payment.kind}</div>
      <div className="opf-pay-amount-lg opf-portal"><span className="opf-pay-big">{eur(payment.amount)}</span><span>{KIND_GR[payment.kind] ?? payment.kind}</span></div>

      {status === 'confirmed' ? (
        <div className="opf-pay-done opf-portal-card" style={{ margin: 0 }}><OpfIcon name="check" size={20} color="var(--success)" stroke={2.6} /> Η πληρωμή ολοκληρώθηκε. Ευχαριστούμε!</div>
      ) : status === 'declared' ? (
        <p style={{ color: 'var(--brand)', fontSize: 14, fontWeight: 600 }}>Λάβαμε τη δήλωσή σας — αναμονή επιβεβαίωσης.</p>
      ) : (
        <>
          {showBank && (
            <>
              <div className="opf-pay-instr">Καταθέστε στον παρακάτω λογαριασμό και δηλώστε την πληρωμή:</div>
              <BankRows beneficiary={beneficiary} bankName={biz?.bankName ?? null} iban={payment.receivingAccount} />
            </>
          )}
          <button className="opf-portal-accept opf-press" style={{ width: '100%', marginTop: 14 }} onClick={() => void declare()} disabled={busy}>
            <OpfIcon name="check" size={18} color="#fff" stroke={2.4} /> {busy ? 'Γίνεται…' : 'Δήλωσα την κατάθεση'}
          </button>
          {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Κάτι πήγε στραβά. Δοκιμάστε ξανά.</p>}
        </>
      )}
    </div>
  );
}

// ── OFFER sheet ──────────────────────────────────────────────────────────────
function OfferSheet({
  open, onClose, token, offer, payments, biz, accepted, onAccepted, onAsk,
}: {
  open: boolean; onClose: () => void; token: string; offer: Offer | null; payments: Payment[]; biz: Biz;
  accepted: boolean; onAccepted: () => void; onAsk: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function accept() {
    if (!offer) return;
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/offer/${offer.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: 'accepted' }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && j?.ok) onAccepted(); else setError(true);
    } catch { setError(true); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Η προσφορά σας">
      {offer ? (
        <>
          {offer.lines.length > 0 && (
            <div className="opf-ev-lines">
              {offer.lines.map((l, i) => <div key={i} className="opf-ev-line"><span>{l.description}</span><b>{eur(l.lineTotal)}</b></div>)}
            </div>
          )}
          <div className="opf-ev-total"><span>Σύνολο{offer.vatRate != null ? ` (με ΦΠΑ ${offer.vatRate}%)` : ''}</span><b>{eur(offer.total)}</b></div>
          <a className="opf-portal-pdf opf-press" href={`/f/${encodeURIComponent(token)}/offer/${offer.id}`}>
            <OpfIcon name="file" size={17} color="var(--brand)" stroke={2} /> Προβολή ολόκληρης προσφοράς (PDF)
          </a>

          {accepted ? (
            <>
              <div className="opf-accepted-tag" style={{ marginBottom: 12 }}>
                <OpfIcon name="check" size={17} color="var(--success)" stroke={2.6} /> Αποδεκτή προσφορά
              </div>
              {payments.map((p) => <PaymentBlock key={p.id} token={token} payment={p} biz={biz} />)}
              {payments.length === 0 && (
                <p style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 4, lineHeight: 1.4 }}>
                  Ευχαριστούμε! Θα λάβετε σύντομα τα στοιχεία πληρωμής.
                </p>
              )}
            </>
          ) : offer.canAccept ? (
            <div className="opf-portal-btns">
              <button className="opf-portal-accept opf-press" onClick={() => void accept()} disabled={busy}>
                <OpfIcon name="check" size={18} color="#fff" stroke={2.4} /> {busy ? 'Γίνεται…' : 'Αποδοχή'}
              </button>
              <button className="opf-portal-ghost opf-press" onClick={onAsk}>Έχω απορία</button>
            </div>
          ) : (
            <div className="opf-accepted-tag" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>{offer.statusLabel}</div>
          )}
          {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Κάτι πήγε στραβά. Δοκιμάστε ξανά.</p>}
        </>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 14.5 }}>Δεν υπάρχει προσφορά ακόμη.</p>
      )}
    </Sheet>
  );
}

// ── APPOINTMENT sheet ───────────────────────────────────────────────────────────
function ApptSheet({
  open, onClose, token, appt, locationLabel, confirmed, onConfirmed,
}: {
  open: boolean; onClose: () => void; token: string; appt: Appt | null; locationLabel: string | null;
  confirmed: boolean; onConfirmed: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'changeRequested' | 'error'>('idle');
  const [showChange, setShowChange] = useState(false);

  async function post(body: Record<string, unknown>, ok: 'confirmed' | 'changeRequested') {
    if (!appt) return;
    setState('busy');
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/appointment/${appt.id}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && j?.ok) { if (ok === 'confirmed') onConfirmed(); else setState('changeRequested'); }
      else setState('error');
    } catch { setState('error'); }
  }

  const options = appt?.date && appt.time
    ? ([shift(appt.date, appt.time, -1), shift(appt.date, appt.time, 1)].filter(Boolean) as { date: string; time: string }[])
    : [];

  return (
    <Sheet open={open} onClose={onClose} title="Το ραντεβού σας">
      {appt ? (
        <>
          <div className="opf-portal-appt">
            <div className="opf-portal-appt-d"><b>{grDate(appt.date)}</b>{appt.time && <span>{appt.time}</span>}</div>
            <div className="opf-portal-appt-t">{appt.typeLabel}</div>
          </div>
          {locationLabel && (
            <div className="opf-appt-loc"><OpfIcon name="pin" size={16} color="var(--brand)" stroke={2} /> {locationLabel}</div>
          )}

          {confirmed ? (
            <div className="opf-accepted-tag" style={{ marginTop: 16 }}><OpfIcon name="check" size={17} color="var(--success)" stroke={2.6} /> Επιβεβαιώθηκε</div>
          ) : state === 'changeRequested' ? (
            <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 16 }}>Ζητήσατε αλλαγή ώρας — θα σας ενημερώσουμε.</p>
          ) : appt.canRespond ? (
            !showChange ? (
              <div className="opf-portal-btns">
                <button className="opf-portal-accept opf-press" onClick={() => void post({ response: 'accepted' }, 'confirmed')} disabled={state === 'busy'}>
                  <OpfIcon name="check" size={18} color="#fff" stroke={2.4} /> {state === 'busy' ? 'Γίνεται…' : 'Επιβεβαίωση'}
                </button>
                {options.length > 0 && <button className="opf-portal-ghost opf-press" onClick={() => setShowChange(true)}>Αλλαγή ώρας</button>}
              </div>
            ) : (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 7 }}>Προτεινόμενες ώρες:</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {options.map((o) => (
                    <button key={`${o.date} ${o.time}`} className="opf-portal-ghost opf-press" disabled={state === 'busy'}
                      onClick={() => void post({ response: 'time_change_requested', requestedDueDate: o.date, requestedDueTime: o.time }, 'changeRequested')}>
                      {o.time}{o.date !== appt.date ? ` (${o.date.slice(8, 10)}/${o.date.slice(5, 7)})` : ''}
                    </button>
                  ))}
                  <button className="opf-press" onClick={() => setShowChange(false)} style={{ fontSize: 14, color: 'var(--muted)', padding: '10px 8px' }}>Άκυρο</button>
                </div>
              </div>
            )
          ) : null}
          {state === 'error' && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Κάτι πήγε στραβά. Δοκιμάστε ξανά.</p>}
        </>
      ) : (
        <p style={{ color: 'var(--muted)', fontSize: 14.5 }}>Δεν υπάρχει ραντεβού ακόμη.</p>
      )}
    </Sheet>
  );
}

// ── FILES sheet (mints an upload link, then navigates to the upload page) ─────────
function FilesSheet({ open, onClose, token }: { open: boolean; onClose: () => void; token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function go() {
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/upload-link`, { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string };
      if (res.ok && j?.ok && typeof j.url === 'string' && j.url) { window.location.href = j.url; return; }
      setError(true); setBusy(false);
    } catch { setError(true); setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Φωτογραφίες / Αρχεία"
      footer={
        <button className="opf-btn-primary opf-full opf-press" onClick={() => void go()} disabled={busy}>
          <OpfIcon name="image" size={19} color="#fff" stroke={2.1} /><span>{busy ? 'Άνοιγμα…' : 'Ανέβασμα φωτογραφιών'}</span>
        </button>
      }>
      <div className="opf-files-grid">
        {[0, 1, 2].map((i) => <div key={i} className="opf-file-thumb"><OpfIcon name="image" size={22} color="var(--muted)" stroke={2} /></div>)}
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 12, lineHeight: 1.45 }}>
        Ανεβάστε φωτογραφίες ή βίντεο του χώρου ώστε να σας εξυπηρετήσουμε καλύτερα.
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Κάτι πήγε στραβά. Δοκιμάστε ξανά.</p>}
    </Sheet>
  );
}

// ── CHAT sheet (two-colour thread: technician left, customer right) ───────────────
function ChatSheet({ open, onClose, token, initial }: { open: boolean; onClose: () => void; token: string; initial: Msg[] }) {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error' | 'rate'>('idle');

  // Live updates: while the sheet is open, poll the folder-scoped messages
  // endpoint (~12s) so the technician's replies appear without a reload. The
  // server is the source of truth, but we only ADOPT a fetched list when it is
  // at least as long as what we already show — so an in-flight optimistic send
  // (appended below before the poll has caught up) is never momentarily wiped.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch(`/api/f/${encodeURIComponent(token)}/message`, { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const j = (await res.json().catch(() => null)) as { ok?: boolean; messages?: Msg[] } | null;
        if (cancelled || !j?.ok || !Array.isArray(j.messages)) return;
        const next = j.messages;
        setMessages((prev) => (next.length >= prev.length ? next : prev));
      } catch { /* keep showing what we have */ }
    }
    void refresh();
    const id = setInterval(() => { if (!document.hidden) void refresh(); }, 12_000);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [open, token]);

  async function send() {
    const t = text.trim();
    if (!t || status === 'sending') return;
    setStatus('sending');
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: t }),
      });
      if (res.ok) {
        setMessages((m) => [...m, { direction: 'in', text: t, createdAt: new Date().toISOString() }]);
        setText(''); setStatus('idle');
      } else if (res.status === 429) setStatus('rate');
      else setStatus('error');
    } catch { setStatus('error'); }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Συνομιλία"
      footer={
        <div className="opf-portal-composer">
          <input className="opf-inp" placeholder="Γράψτε την ερώτησή σας…" value={text}
            onChange={(e) => { setText(e.target.value); if (status === 'error' || status === 'rate') setStatus('idle'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} maxLength={1000} />
          <button className="opf-pj-send opf-press" onClick={() => void send()} disabled={status === 'sending' || !text.trim()} aria-label="Αποστολή">
            <OpfIcon name="send" size={19} color="#fff" stroke={2} />
          </button>
        </div>
      }>
      <div className="opf-chat-day">Συνομιλία με τον τεχνικό</div>
      {messages.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 14, textAlign: 'center', padding: '12px 8px' }}>
          Στείλτε μας την απορία σας — θα σας απαντήσουμε εδώ.
        </p>
      ) : (
        messages.map((m, i) => (
          <div key={i} className={'opf-bub ' + (m.direction === 'out' ? 'opf-l' : 'opf-r')} style={{ marginBottom: 8 }}>
            <div className={'opf-bubble ' + (m.direction === 'out' ? 'opf-role-tech' : 'opf-role-cust')} style={{ padding: '11px 14px' }}>{m.text}</div>
          </div>
        ))
      )}
      {status === 'error' && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Δεν στάλθηκε. Δοκιμάστε ξανά.</p>}
      {status === 'rate' && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Πολλά αιτήματα. Δοκιμάστε ξανά σε λίγο.</p>}
    </Sheet>
  );
}

// ── social / contact footer ──────────────────────────────────────────────────────
function PortalFooter({ biz }: { biz: Biz }) {
  if (!biz) return null;
  const tel = biz.phone ? `tel:${biz.phone.replace(/\s+/g, '')}` : null;
  const fb = socialHref(biz.facebookUrl, 'facebook.com');
  const ig = socialHref(biz.instagramUrl, 'instagram.com');
  return (
    <>
      {(tel || fb || ig) && (
        <div className="opf-psocial">
          {tel && <a className="opf-psoc opf-press" href={tel} aria-label="Τηλέφωνο"><OpfIcon name="phone" size={20} color="var(--brand)" stroke={2} /></a>}
          {fb && (
            <a className="opf-psoc opf-press" href={fb} target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--brand)" aria-hidden="true"><path d="M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4z" /></svg>
            </a>
          )}
          {ig && (
            <a className="opf-psoc opf-press" href={ig} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="3.8" /><circle cx="17.2" cy="6.8" r="1.2" fill="var(--brand)" stroke="none" /></svg>
            </a>
          )}
        </div>
      )}
      {biz.phone && <div className="opf-pcontact">Επικοινωνία: {biz.phone}</div>}
      <div className="opf-phelp">Φιλικά, Opiflow Assistant για λογαριασμό του {biz.name}</div>
      <div className="opf-phelp" style={{ marginTop: 6 }}>
        Τα στοιχεία που καταχωρείτε επεξεργάζονται για την εξυπηρέτησή σας από τον/την {biz.name}.{' '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', textDecoration: 'underline' }}>Πολιτική Απορρήτου</a>
      </div>
    </>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function PortalView({ token, view }: { token: string; view: PublicFolderView }) {
  const [theme] = useState<'light' | 'dark'>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [sheet, setSheet] = useState<SheetKey>(null);

  const biz = view.business;
  const primaryOffer = view.offers[0] ?? null;
  const appt = view.appointments[0] ?? null;

  const [offerAccepted, setOfferAccepted] = useState<boolean>(primaryOffer?.accepted ?? false);
  // Seed from the server so a confirmed appointment stays «Έγινε» after reload.
  const [apptConfirmed, setApptConfirmed] = useState<boolean>(appt?.confirmed ?? false);

  const paymentOutstanding = view.payments.some((p) => p.status !== 'confirmed');

  // ── tile state ──
  const offerReview = !!(primaryOffer && primaryOffer.canAccept && !offerAccepted);
  let offerBadge: { t: string; tone: 'brand' | 'warn' | 'ok' } | null = null;
  if (primaryOffer) {
    if (offerReview) offerBadge = { t: 'Ελέγξτε', tone: 'brand' };
    else if (offerAccepted && paymentOutstanding) offerBadge = { t: 'Πληρωμή', tone: 'warn' };
    else if (offerAccepted) offerBadge = { t: 'Έγινε', tone: 'ok' };
  }

  const apptHandled = appt ? (apptConfirmed || !appt.canRespond) : false;
  const apptReview = !!(appt && !apptHandled);
  const apptBadge: { t: string; tone: 'brand' | 'ok' } | null = appt
    ? (apptHandled ? { t: 'Έγινε', tone: 'ok' } : { t: 'Ελέγξτε', tone: 'brand' })
    : null;

  // ── updates feed (newest-ish first; welcome last) ──
  type Update = { ic: string; t: string; when: string | null };
  const updates: Update[] = [];
  if (appt) updates.push({ ic: 'calendar', t: `Προτάθηκε ραντεβού${appt.date ? ` για ${grDate(appt.date)}` : ''}`, when: appt.createdAt });
  if (primaryOffer) updates.push({ ic: 'file', t: 'Λάβατε νέα προσφορά', when: primaryOffer.createdAt });
  for (const p of view.payments) {
    updates.push({ ic: 'euro', t: p.kind === 'deposit' ? 'Αίτημα προκαταβολής' : p.kind === 'balance' ? 'Αίτημα εξόφλησης' : 'Αίτημα πληρωμής', when: null });
  }
  updates.push({ ic: 'link', t: 'Καλωσορίσατε στη σελίδα του έργου σας', when: null });

  return (
    <div className="opf-stage opf-portal" data-theme={theme} style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative' }}>
      <div style={{ maxWidth: 460, margin: '0 auto', paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom))' }}>
        {/* hero */}
        <div className="opf-phub">
          <div className="opf-phub-logo">
            {biz?.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={biz.logoUrl} alt={biz.name} style={{ width: 52, height: 52, borderRadius: 15, objectFit: 'contain' }} />
            ) : (
              <OpfLogo size={52} radius={15} />
            )}
          </div>
          <div className="opf-phub-biz">{biz?.name ?? 'Η επιχείρηση'}</div>
          <div className="opf-phub-title">{view.title}</div>
          <div className="opf-phub-sub">Το έργο σας σε ένα μέρος — προσφορά, ραντεβού και επικοινωνία.</div>
          {view.locationLabel && (
            <div className="opf-phub-loc"><OpfIcon name="pin" size={14} color="var(--muted)" stroke={2} /> {view.locationLabel}</div>
          )}
        </div>

        {/* 4-tile launcher */}
        <div className="opf-tiles">
          <button className={'opf-tile opf-press' + (primaryOffer ? (offerReview ? ' opf-review' : '') : ' opf-off')} onClick={() => primaryOffer && setSheet('offer')} disabled={!primaryOffer}>
            {offerBadge && <span className={'opf-tile-badge opf-tb-' + offerBadge.tone}>{offerBadge.t}</span>}
            <div className="opf-tile-ic"><OpfIcon name="file" size={22} color="#fff" stroke={2.1} /></div>
            <div className="opf-tile-t">Προσφορά</div>
            <div className="opf-tile-s">{primaryOffer ? 'Προβολή & αποδοχή' : 'Θα εμφανιστεί μόλις σταλεί'}</div>
          </button>

          <button className={'opf-tile opf-press' + (appt ? (apptReview ? ' opf-review' : '') : ' opf-off')} onClick={() => appt && setSheet('appt')} disabled={!appt}>
            {apptBadge && <span className={'opf-tile-badge opf-tb-' + apptBadge.tone}>{apptBadge.t}</span>}
            <div className="opf-tile-ic opf-ic-appt"><OpfIcon name="calendar" size={22} color="#fff" stroke={2.1} /></div>
            <div className="opf-tile-t">Ραντεβού</div>
            <div className="opf-tile-s">{appt ? 'Επιβεβαίωση ή αλλαγή' : 'Θα εμφανιστεί μόλις σταλεί'}</div>
          </button>

          <button className="opf-tile opf-press" onClick={() => setSheet('files')}>
            <div className="opf-tile-ic opf-ic-files"><OpfIcon name="image" size={22} color="#fff" stroke={2.1} /></div>
            <div className="opf-tile-t">Φωτογραφίες</div>
            <div className="opf-tile-s">Ανέβασμα αρχείων</div>
          </button>

          <button className="opf-tile opf-press" onClick={() => setSheet('chat')}>
            <div className="opf-tile-ic opf-ic-chat"><OpfIcon name="message" size={22} color="#fff" stroke={2.1} /></div>
            <div className="opf-tile-t">Απορία</div>
            <div className="opf-tile-s">Στείλτε μας μήνυμα</div>
          </button>
        </div>

        {/* updates feed */}
        <div className="opf-psec">Ενημερώσεις</div>
        <div className="opf-ufeed">
          {updates.map((u, i) => (
            <div key={i} className="opf-update-row">
              <div className="opf-update-ic"><OpfIcon name={u.ic} size={17} color="var(--brand)" stroke={2} /></div>
              <div className="opf-update-main">
                <div className="opf-update-t">{u.t}</div>
                {u.when && <div className="opf-update-when">{fmtWhen(u.when)}</div>}
              </div>
            </div>
          ))}
        </div>

        {/* social + contact */}
        <PortalFooter biz={biz} />
      </div>

      {/* bottom sheets */}
      <OfferSheet open={sheet === 'offer'} onClose={() => setSheet(null)} token={token} offer={primaryOffer} payments={view.payments} biz={biz}
        accepted={offerAccepted} onAccepted={() => setOfferAccepted(true)} onAsk={() => setSheet('chat')} />
      <ApptSheet open={sheet === 'appt'} onClose={() => setSheet(null)} token={token} appt={appt} locationLabel={view.locationLabel}
        confirmed={apptConfirmed} onConfirmed={() => setApptConfirmed(true)} />
      <FilesSheet open={sheet === 'files'} onClose={() => setSheet(null)} token={token} />
      <ChatSheet open={sheet === 'chat'} onClose={() => setSheet(null)} token={token} initial={view.messages} />
    </div>
  );
}
