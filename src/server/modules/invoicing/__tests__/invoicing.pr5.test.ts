import { describe, it, expect, vi } from 'vitest';
import { autoIssueInvoiceForPayment } from '../invoicing.service';

// Minimal in-memory fake supabase (settings + invoices reads/writes only).
function makeFakeSupabase(store: Record<string, Record<string, unknown>[]>) {
  let idc = 2000;
  const matches = (row: Record<string, unknown>, filters: [string, unknown][]) => filters.every(([c, v]) => row[c] === v);
  function build(table: string) {
    const st: { op: string; filters: [string, unknown][]; single: false | 'maybe' | 'single'; values: Record<string, unknown> | null } = { op: 'select', filters: [], single: false, values: null };
    let ran = false, cached: unknown;
    const run = () => {
      if (ran) return cached; ran = true;
      const rows = (store[table] ??= []);
      if (st.op === 'insert') { const row = { id: `id${idc++}`, ...st.values }; rows.push(row); cached = { data: st.single ? row : [row], error: null }; }
      else if (st.op === 'update') { const h = rows.filter((r) => matches(r, st.filters)); h.forEach((r) => Object.assign(r, st.values)); cached = { data: st.single ? h[0] ?? null : h, error: null }; }
      else { const s = rows.filter((r) => matches(r, st.filters)); cached = { data: st.single ? s[0] ?? null : s, error: null }; }
      return cached;
    };
    const api: Record<string, unknown> = {
      select: () => api, insert: (v: Record<string, unknown>) => { st.op = 'insert'; st.values = v; return api; },
      update: (v: Record<string, unknown>) => { st.op = 'update'; st.values = v; return api; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return api; },
      in: () => api, order: () => api, range: () => api,
      maybeSingle: () => { st.single = 'maybe'; return api; }, single: () => { st.single = 'single'; return api; },
      then: (resolve: (r: unknown) => void) => resolve(run()),
    };
    return api;
  }
  return { from: (t: string) => build(t) } as never;
}

const cfg = () => ({ apiKey: 'pk', baseUrl: 'https://demo', mode: 'production' as const });
const mkOkSubmit = () => vi.fn(async () => ({ ok: true, statusCode: 'Success', mark: '400077', uid: 'U', authenticationCode: 'A', qrUrl: 'q', errors: [], httpStatus: 200, rawResponse: '<ok/>' }));
const ROW = { id: 'p1', amount: 124, customer_id: null, offer_id: null, kind: 'balance' };

describe('invoicing — autoIssueInvoiceForPayment', () => {
  it('issues a myDATA invoice when enabled + auto_issue_on_payment (idempotent dedup pay:<id>)', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: true, auto_issue_on_payment: true, issuer_vat: '094000000', issuer_branch: 0 }], invoices: [] as Record<string, unknown>[] };
    const ctx = { businessId: 'biz1', userId: 'u', role: 'owner', supabase: makeFakeSupabase(store) };
    const submit = mkOkSubmit();
    const inv = await autoIssueInvoiceForPayment(ctx as never, ROW, { getConfig: cfg, submit: submit as never });
    expect(inv?.status).toBe('issued');
    expect(inv?.dedup_key).toBe('pay:p1');
    expect(store.invoices).toHaveLength(1);
    // Confirming the same payment again must not double-issue.
    await autoIssueInvoiceForPayment(ctx as never, ROW, { getConfig: cfg, submit: submit as never });
    expect(submit).toHaveBeenCalledOnce();
    expect(store.invoices).toHaveLength(1);
  });

  it('does NOTHING when auto_issue_on_payment is off', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: true, auto_issue_on_payment: false, issuer_vat: '094000000', issuer_branch: 0 }], invoices: [] as Record<string, unknown>[] };
    const ctx = { businessId: 'biz1', userId: 'u', role: 'owner', supabase: makeFakeSupabase(store) };
    const inv = await autoIssueInvoiceForPayment(ctx as never, ROW, { getConfig: cfg, submit: mkOkSubmit() as never });
    expect(inv).toBeNull();
    expect(store.invoices).toHaveLength(0);
  });

  it('does NOTHING when the provider is not configured', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: true, auto_issue_on_payment: true, issuer_vat: '094000000' }], invoices: [] as Record<string, unknown>[] };
    const ctx = { businessId: 'biz1', userId: 'u', role: 'owner', supabase: makeFakeSupabase(store) };
    const inv = await autoIssueInvoiceForPayment(ctx as never, ROW, { getConfig: () => null });
    expect(inv).toBeNull();
    expect(store.invoices).toHaveLength(0);
  });

  it('never throws even if settings are missing (best-effort)', async () => {
    const store = { business_invoicing_settings: [] as Record<string, unknown>[], invoices: [] as Record<string, unknown>[] };
    const ctx = { businessId: 'biz1', userId: 'u', role: 'owner', supabase: makeFakeSupabase(store) };
    const inv = await autoIssueInvoiceForPayment(ctx as never, ROW, { getConfig: cfg, submit: mkOkSubmit() as never });
    expect(inv).toBeNull();
  });
});
