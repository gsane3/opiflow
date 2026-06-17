'use client';

// Public customer portal — pixel-faithful port of the prototype PortalScreen
// (screens-project.jsx) using the prototype's own design system (opf-* CSS on
// .opf-stage). Hero greeting · project title · stepper · offer card (line items +
// total + full-PDF link + Αποδοχή/Έχω απορία) · payments (δικαιούχος + IBAN copy +
// «Δήλωσα την κατάθεση») · appointment (Επιβεβαίωση/Αλλαγή ώρας) · questions chat.
// All actions hit the existing folder-token-scoped /api/f/[token]/* endpoints.

import { useRef, useState } from 'react';
import { OpfIcon, OpfLogo } from '@/components/opf/icon';
import type { PublicFolderView } from '@/lib/server/public-folder';

const STEPS = ['Επαφή', 'Προσφορά', 'Πληρωμή', 'Ραντεβού', 'Τέλος'] as const;
const KIND_GR: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };

function eur(n: number | null | undefined): string {
  return typeof n === 'number'
    ? `${n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
    : '—';
}
function fmtDate(s: string | null): string {
  if (!s) return '';
  const [y, m, d] = s.split('T')[0].split('-');
  return y && m && d ? `${d}/${m}/${y}` : s;
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

function Stepper({ step }: { step: number }) {
  return (
    <div className="opf-stepper">
      {STEPS.map((s, i) => {
        const state = i < step ? 'done' : i === step ? 'now' : 'todo';
        return (
          <span key={s} style={{ display: 'contents' }}>
            <div className={`opf-step opf-${state}`}>
              <div className="opf-step-dot">{i < step ? <OpfIcon name="check" size={13} color="#fff" stroke={2.8} /> : <span>{i + 1}</span>}</div>
              <span className="opf-step-label">{s}</span>
            </div>
            {i < STEPS.length - 1 && <div className={'opf-step-bar' + (i < step ? ' opf-done' : '')} />}
          </span>
        );
      })}
    </div>
  );
}

// Normalize a stored social value (full URL or @handle/handle) to an href.
function socialHref(value: string | null | undefined, domain: string): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, '').replace(/^\/+/, '');
  return handle ? `https://${domain}/${handle}` : null;
}

function ContactIcons({ biz }: { biz: PublicFolderView['business'] }) {
  if (!biz) return null;
  const tel = biz.phone ? `tel:${biz.phone.replace(/\s+/g, '')}` : null;
  const fb = socialHref(biz.facebookUrl, 'facebook.com');
  const ig = socialHref(biz.instagramUrl, 'instagram.com');
  if (!tel && !fb && !ig) return null;
  const circle: React.CSSProperties = { width: 42, height: 42, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', border: '1px solid var(--line)', flexShrink: 0 };
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
      {tel && <a href={tel} aria-label="Κλήση" className="opf-press" style={circle}><OpfIcon name="phone" size={20} color="var(--brand)" stroke={2} /></a>}
      {fb && (
        <a href={fb} target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="opf-press" style={circle}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--brand)" aria-hidden="true"><path d="M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4z" /></svg>
        </a>
      )}
      {ig && (
        <a href={ig} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="opf-press" style={circle}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="3.8" /><circle cx="17.2" cy="6.8" r="1.2" fill="var(--brand)" stroke="none" /></svg>
        </a>
      )}
    </div>
  );
}

type Offer = PublicFolderView['offers'][number];
type Appt = PublicFolderView['appointments'][number];
type Payment = PublicFolderView['payments'][number];

export default function PortalView({ token, view }: { token: string; view: PublicFolderView }) {
  const [theme] = useState<'light' | 'dark'>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const composerRef = useRef<HTMLInputElement>(null);

  const biz = view.business;
  const focusComposer = () => { composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); composerRef.current?.focus(); };

  const nothing = view.offers.length === 0 && view.appointments.length === 0 && view.payments.length === 0;

  return (
    <div className="opf-stage opf-portal" data-theme={theme} style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 460, margin: '0 auto', padding: '20px 16px calc(2.5rem + env(safe-area-inset-bottom))' }}>
        {/* hero */}
        <div className="opf-portal-hero">
          <div className="opf-portal-biz">
            {biz?.logoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={biz.logoUrl} alt={biz.name} style={{ width: 40, height: 40, borderRadius: 12, objectFit: 'contain', flexShrink: 0 }} />
            ) : (
              <OpfLogo size={40} radius={12} />
            )}
            <div style={{ minWidth: 0 }}>
              <div className="opf-portal-biz-n">{biz?.name ?? 'Η επιχείρηση'}</div>
              {biz?.phone && <div className="opf-portal-biz-s">{biz.phone}</div>}
            </div>
          </div>
          <div className="opf-portal-greet">Γεια σας{view.greetingName ? ` ${view.greetingName}` : ''} 👋</div>
          <div className="opf-portal-sub">Παρακολουθήστε το έργο σας εδώ. Όλα σε ένα μέρος.</div>

          <ContactIcons biz={biz} />

          {/* project title (single project → read-only switcher style) */}
          <div className="opf-portal-switch" style={{ cursor: 'default' }}>
            <OpfIcon name="folder" size={17} color="var(--brand)" stroke={2} />
            <span>{view.title}</span>
          </div>
        </div>

        {/* stepper */}
        <div className="opf-portal-card opf-stepper-card"><Stepper step={view.step} /></div>

        {/* offers */}
        {view.offers.map((o) => <OfferCard key={o.id} token={token} offer={o} onAsk={focusComposer} />)}

        {/* payments */}
        {view.payments.map((p) => (
          <PaymentBlock key={p.id} token={token} payment={p} bankName={biz?.bankName ?? null} beneficiary={biz?.bankBeneficiary ?? null} />
        ))}

        {/* appointments */}
        {view.appointments.map((a) => <ApptCard key={a.id} token={token} appt={a} />)}

        {/* empty */}
        {nothing && (
          <div className="opf-portal-card" style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14.5 }}>
            Δεν υπάρχει κάτι ακόμα. Θα ενημερωθείτε για κάθε νεότερο.
          </div>
        )}

        {/* questions */}
        <QuestionsCard token={token} initial={view.messages} composerRef={composerRef} />

        <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, marginTop: 14 }}>Επικοινωνήστε μαζί μας αν χρειάζεστε βοήθεια.</p>
      </div>
    </div>
  );
}

// ── offer ────────────────────────────────────────────────────────────────────
function OfferCard({ token, offer, onAsk }: { token: string; offer: Offer; onAsk: () => void }) {
  const [accepted, setAccepted] = useState(offer.accepted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function accept() {
    setBusy(true); setError(false);
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/offer/${offer.id}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: 'accepted' }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && j?.ok) setAccepted(true); else setError(true);
    } catch { setError(true); } finally { setBusy(false); }
  }

  return (
    <div className="opf-portal-card">
      <div className="opf-portal-card-h"><OpfIcon name="file" size={18} color="var(--brand)" stroke={2} /> Η προσφορά σας</div>
      {offer.lines.length > 0 && (
        <div className="opf-ev-lines">
          {offer.lines.map((l, i) => <div key={i} className="opf-ev-line"><span>{l.description}</span><b>{eur(l.lineTotal)}</b></div>)}
        </div>
      )}
      <div className="opf-ev-total"><span>Σύνολο{offer.vatRate != null ? ` (με ΦΠΑ ${offer.vatRate}%)` : ''}</span><b>{eur(offer.total)}</b></div>
      <a className="opf-portal-pdf opf-press" href={`/f/${encodeURIComponent(token)}/offer/${offer.id}`}>
        <OpfIcon name="file" size={17} color="var(--brand)" stroke={2} /> Προβολή ολόκληρης προσφοράς (PDF)
      </a>
      <div className="opf-portal-btns">
        {accepted ? (
          <div className="opf-accepted-tag"><OpfIcon name="check" size={17} color="var(--success)" stroke={2.6} /> Αποδεκτή</div>
        ) : offer.canAccept ? (
          <button className="opf-portal-accept opf-press" onClick={() => void accept()} disabled={busy}>
            <OpfIcon name="check" size={18} color="#fff" stroke={2.4} /> {busy ? 'Γίνεται…' : 'Αποδοχή'}
          </button>
        ) : (
          <div className="opf-accepted-tag" style={{ color: 'var(--muted)' }}>{offer.statusLabel}</div>
        )}
        <button className="opf-portal-ghost opf-press" onClick={onAsk}>Έχω απορία</button>
      </div>
      {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Κάτι πήγε στραβά. Δοκιμάστε ξανά.</p>}
    </div>
  );
}

// ── payment ──────────────────────────────────────────────────────────────────
function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* visible to copy manually */ }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8, padding: '9px 12px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--line)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--muted)' }}>{label}</div>
        <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{value}</div>
      </div>
      <button type="button" className="opf-press" onClick={copy} style={{ flexShrink: 0, borderRadius: 10, padding: '8px 11px', fontSize: 12.5, fontWeight: 700, background: 'var(--tint)', color: 'var(--brand)' }}>{copied ? 'Αντιγράφηκε ✓' : 'Αντιγραφή'}</button>
    </div>
  );
}
function PaymentBlock({ token, payment, bankName, beneficiary }: { token: string; payment: Payment; bankName: string | null; beneficiary: string | null }) {
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

  const showBank = status === 'pending' && (beneficiary || payment.receivingAccount);

  return (
    <div className="opf-portal-card">
      <div className="opf-portal-card-h"><OpfIcon name="euro" size={18} color="var(--brand)" stroke={2} /> {KIND_GR[payment.kind] ?? payment.kind}</div>
      <div className="opf-ev-total" style={{ marginTop: 4 }}><span>Ποσό</span><b>{eur(payment.amount)}</b></div>

      {showBank && (
        <div style={{ marginTop: 10 }}>
          {bankName && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Τράπεζα: <b style={{ color: 'var(--ink-2)' }}>{bankName}</b></div>}
          {beneficiary && <CopyRow label="Δικαιούχος" value={beneficiary} />}
          {payment.receivingAccount && <CopyRow label="IBAN" value={payment.receivingAccount} />}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {status === 'confirmed' ? (
          <div className="opf-accepted-tag"><OpfIcon name="check" size={17} color="var(--success)" stroke={2.6} /> Επιβεβαιώθηκε</div>
        ) : status === 'declared' ? (
          <p style={{ color: 'var(--brand)', fontSize: 14, fontWeight: 600 }}>Λάβαμε τη δήλωσή σας — αναμονή επιβεβαίωσης.</p>
        ) : (
          <button className="opf-portal-accept opf-press" onClick={() => void declare()} disabled={busy}>{busy ? 'Γίνεται…' : 'Δήλωσα την κατάθεση'}</button>
        )}
        {error && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 6 }}>Κάτι πήγε στραβά. Δοκιμάστε ξανά.</p>}
      </div>
    </div>
  );
}

// ── appointment ──────────────────────────────────────────────────────────────
function ApptCard({ token, appt }: { token: string; appt: Appt }) {
  const [state, setState] = useState<'idle' | 'busy' | 'confirmed' | 'changeRequested' | 'error'>('idle');
  const [showChange, setShowChange] = useState(false);

  async function post(body: Record<string, unknown>, ok: 'confirmed' | 'changeRequested') {
    setState('busy');
    try {
      const res = await fetch(`/api/f/${encodeURIComponent(token)}/appointment/${appt.id}/respond`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setState(res.ok && j?.ok ? ok : 'error');
    } catch { setState('error'); }
  }

  const options = appt.date && appt.time ? [shift(appt.date, appt.time, -1), shift(appt.date, appt.time, 1)].filter(Boolean) as { date: string; time: string }[] : [];

  return (
    <div className="opf-portal-card">
      <div className="opf-portal-card-h"><OpfIcon name="calendar" size={18} color="var(--brand)" stroke={2} /> Το ραντεβού σας</div>
      <div className="opf-portal-appt">
        <div className="opf-portal-appt-d"><b>{fmtDate(appt.date)}</b>{appt.time && <span>{appt.time}</span>}</div>
        <div className="opf-portal-appt-t">{appt.typeLabel}</div>
      </div>

      {state === 'confirmed' ? (
        <div className="opf-accepted-tag" style={{ marginTop: 10 }}><OpfIcon name="check" size={17} color="var(--success)" stroke={2.6} /> Επιβεβαιώθηκε</div>
      ) : state === 'changeRequested' ? (
        <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 10 }}>Ζητήσατε αλλαγή ώρας — θα σας ενημερώσουμε.</p>
      ) : appt.canRespond ? (
        !showChange ? (
          <div className="opf-portal-btns">
            <button className="opf-portal-accept opf-press" onClick={() => void post({ response: 'accepted' }, 'confirmed')} disabled={state === 'busy'}>
              <OpfIcon name="check" size={18} color="#fff" stroke={2.4} /> {state === 'busy' ? 'Γίνεται…' : 'Επιβεβαίωση'}
            </button>
            {options.length > 0 && <button className="opf-portal-ghost opf-press" onClick={() => setShowChange(true)}>Αλλαγή ώρας</button>}
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
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
    </div>
  );
}

// ── questions ────────────────────────────────────────────────────────────────
function QuestionsCard({ token, initial, composerRef }: { token: string; initial: PublicFolderView['messages']; composerRef: React.RefObject<HTMLInputElement | null> }) {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error' | 'rate'>('idle');

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
    <div className="opf-portal-card">
      <div className="opf-portal-card-h"><OpfIcon name="message" size={18} color="var(--brand)" stroke={2} /> Ερωτήσεις</div>
      {messages.length > 0 && (
        <div className="opf-portal-chat">
          {messages.map((m, i) => (
            <div key={i} className={'opf-bub ' + (m.direction === 'out' ? 'opf-l' : 'opf-r')}>
              <div className={'opf-bubble ' + (m.direction === 'out' ? 'opf-role-tech' : 'opf-role-cust')}>{m.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="opf-portal-composer">
        <input ref={composerRef} className="opf-inp" placeholder="Γράψτε την ερώτησή σας…" value={text}
          onChange={(e) => { setText(e.target.value); if (status === 'error' || status === 'rate') setStatus('idle'); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} maxLength={1000} />
        <button className="opf-pj-send opf-press" onClick={() => void send()} disabled={status === 'sending' || !text.trim()} aria-label="Αποστολή">
          <OpfIcon name="send" size={19} color="#fff" stroke={2} />
        </button>
      </div>
      {status === 'error' && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Δεν στάλθηκε. Δοκιμάστε ξανά.</p>}
      {status === 'rate' && <p style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>Πολλά αιτήματα. Δοκιμάστε ξανά σε λίγο.</p>}
    </div>
  );
}
