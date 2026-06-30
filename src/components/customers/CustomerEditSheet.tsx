'use client';

// Edit-details popup for the customer profile (opened by the pencil). A centered
// modal in the prototype's design system (opf-* on .opf-stage). Loads the full
// customer on open, splits the single `name` column into Όνομα + Επώνυμο, and
// PATCHes /api/customers/[id] on save. Replaces the old chat-era CustomerInfoPanel.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { OpfIcon } from '@/components/opf/icon';

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

interface CustomerFull {
  name: string | null; companyName: string | null; vatNumber: string | null;
  mobilePhone: string | null; landlinePhone: string | null;
  email: string | null; address: string | null;
  postalCode: string | null; region: string | null;
  source: string | null; preferredContactMethod: string | null; needsSummary: string | null;
}

const EMPTY = {
  firstName: '', lastName: '', companyName: '', vatNumber: '', mobilePhone: '', landlinePhone: '',
  email: '', address: '', postalCode: '', region: '', preferredContactMethod: 'phone', source: '', needsSummary: '',
};

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}

export default function CustomerEditSheet({
  customerId, open, onClose, onSaved,
}: {
  customerId: string; open: boolean; onClose: () => void; onSaved?: () => void;
}) {
  const [theme] = useState<'light' | 'dark'>(() => (typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) { setLoading(false); return; }
      const res = await fetch(`/api/customers/${customerId}`, { headers });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; customer?: CustomerFull };
      if (j?.ok && j.customer) {
        const c = j.customer;
        const parts = (c.name ?? '').trim().split(/\s+/).filter(Boolean);
        setForm({
          firstName: parts[0] ?? '', lastName: parts.slice(1).join(' '),
          companyName: c.companyName ?? '', vatNumber: c.vatNumber ?? '', mobilePhone: c.mobilePhone ?? '',
          landlinePhone: c.landlinePhone ?? '', email: c.email ?? '', address: c.address ?? '',
          postalCode: c.postalCode ?? '', region: c.region ?? '',
          preferredContactMethod: c.preferredContactMethod ?? 'phone', source: c.source ?? '', needsSummary: c.needsSummary ?? '',
        });
      }
    } catch { /* non-fatal */ } finally { setLoading(false); }
  }, [customerId]);

  useEffect(() => { if (open) { setForm(EMPTY); void load(); } }, [open, load]);

  if (!open) return null;

  async function save() {
    setBusy(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({
          name: `${form.firstName} ${form.lastName}`.trim() || null,
          companyName: form.companyName || null,
          vatNumber: form.vatNumber.trim() || null,
          mobilePhone: form.mobilePhone || null, phone: form.mobilePhone || null,
          landlinePhone: form.landlinePhone || null, email: form.email || null, address: form.address || null,
          postalCode: form.postalCode || null, region: form.region || null,
          preferredContactMethod: form.preferredContactMethod || 'phone',
          source: form.source || null, needsSummary: form.needsSummary || null,
        }),
      });
      if (res.ok) { onSaved?.(); onClose(); }
    } catch { /* non-fatal */ } finally { setBusy(false); }
  }

  return (
    <div className="opf-stage" data-theme={theme} style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <button type="button" aria-label="Κλείσιμο" onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(8,16,26,0.45)' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'relative', width: '100%', maxWidth: 440, maxHeight: '88vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 22, boxShadow: '0 24px 60px rgba(8,16,26,0.35)', padding: '18px 18px 16px' }}>
        <div className="opf-sheet-head">
          <div className="opf-sheet-title">Επεξεργασία στοιχείων</div>
          <button className="opf-sheet-x opf-press" onClick={onClose} aria-label="Κλείσιμο"><OpfIcon name="x" size={20} color="var(--muted)" stroke={2.2} /></button>
        </div>

        <div className="opf-sheet-body" style={{ minHeight: 120 }}>
          {loading ? (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>Φόρτωση…</div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10 }}>
                <label className="opf-field" style={{ flex: 1 }}><span className="opf-field-label">Όνομα</span><input className="opf-inp" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} /></label>
                <label className="opf-field" style={{ flex: 1 }}><span className="opf-field-label">Επώνυμο</span><input className="opf-inp" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} /></label>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <label className="opf-field" style={{ flex: 1 }}><span className="opf-field-label">Εταιρεία</span><input className="opf-inp" value={form.companyName} placeholder="Προαιρετικό" onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} /></label>
                <label className="opf-field" style={{ flex: '0 0 40%' }}><span className="opf-field-label">ΑΦΜ</span><input className="opf-inp" inputMode="numeric" value={form.vatNumber} placeholder="Για τιμολόγιο" onChange={(e) => setForm((f) => ({ ...f, vatNumber: e.target.value }))} /></label>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <label className="opf-field" style={{ flex: 1 }}><span className="opf-field-label">Κινητό</span><input className="opf-inp" inputMode="tel" value={form.mobilePhone} onChange={(e) => setForm((f) => ({ ...f, mobilePhone: e.target.value }))} /></label>
                <label className="opf-field" style={{ flex: 1 }}><span className="opf-field-label">Σταθερό</span><input className="opf-inp" inputMode="tel" value={form.landlinePhone} onChange={(e) => setForm((f) => ({ ...f, landlinePhone: e.target.value }))} /></label>
              </div>
              <label className="opf-field"><span className="opf-field-label">Email</span><input className="opf-inp" inputMode="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></label>
              <label className="opf-field"><span className="opf-field-label">Διεύθυνση</span><input className="opf-inp" value={form.address} placeholder="Οδός & αριθμός" onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></label>
              <div style={{ display: 'flex', gap: 10 }}>
                <label className="opf-field" style={{ flex: '0 0 38%' }}><span className="opf-field-label">Τ.Κ.</span><input className="opf-inp" inputMode="numeric" value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} /></label>
                <label className="opf-field" style={{ flex: 1 }}><span className="opf-field-label">Περιοχή</span><input className="opf-inp" value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} /></label>
              </div>
              <label className="opf-field"><span className="opf-field-label">Προτιμώμενο κανάλι</span>
                <select className="opf-inp" value={form.preferredContactMethod} onChange={(e) => setForm((f) => ({ ...f, preferredContactMethod: e.target.value }))}>
                  {CONTACT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </label>
              <label className="opf-field"><span className="opf-field-label">Πηγή</span>
                <select className="opf-inp" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
                  <option value="">— Χωρίς πηγή —</option>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </label>
              <label className="opf-field" style={{ marginBottom: 4 }}><span className="opf-field-label">Ανάγκες πελάτη</span><textarea className="opf-ta" rows={2} value={form.needsSummary} placeholder="Τι χρειάζεται ο πελάτης…" onChange={(e) => setForm((f) => ({ ...f, needsSummary: e.target.value }))} /></label>
            </>
          )}
        </div>

        <div className="opf-sheet-foot" style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="opf-press" onClick={onClose} style={{ flex: '0 0 auto', padding: '15px 22px', borderRadius: 16, background: 'var(--surface-2)', color: 'var(--ink-2)', fontWeight: 700, fontSize: 15 }}>Ακύρωση</button>
          <button type="button" className="opf-btn-primary opf-full opf-press" onClick={() => void save()} disabled={busy || loading} style={busy || loading ? { opacity: 0.6 } : undefined}>{busy ? 'Αποθήκευση…' : 'Αποθήκευση'}</button>
        </div>
      </div>
    </div>
  );
}
