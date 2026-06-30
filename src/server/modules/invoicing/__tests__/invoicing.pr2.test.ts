import { describe, it, expect, vi } from 'vitest';
import { buildInvoicesDocXml } from '../mydata-xml';
import { parseSbzResponse, submitInvoiceToSbz, type FetchLike } from '../providers/sbz';
import { planFromOffer, planFromGross, issueInvoiceDocument, type IssuerInfo } from '../invoicing.service';
import type { OfferRow, OfferItemRow } from '../../offers/offers.types';

// ── myDATA XML builder ──────────────────────────────────────────────────────
describe('mydata-xml — buildInvoicesDocXml', () => {
  it('builds a B2C (11.2) doc with net/VAT/gross and NO counterpart', () => {
    const xml = buildInvoicesDocXml({
      issuerVat: '094000000', issueDate: '2026-06-30', invoiceType: '11.2',
      lines: [{ lineNumber: 1, netValue: 100, vatCategory: 1, vatAmount: 24, incomeClassificationType: 'E3_561_001', incomeClassificationCategory: 'category1_3' }],
    });
    expect(xml).toContain('<invoiceType>11.2</invoiceType>');
    expect(xml).toContain('<netValue>100.00</netValue>');
    expect(xml).toContain('<vatCategory>1</vatCategory>');
    expect(xml).toContain('<vatAmount>24.00</vatAmount>');
    expect(xml).toContain('<totalGrossValue>124.00</totalGrossValue>');
    expect(xml).not.toContain('<counterpart>');
    expect(xml).toContain('E3_561_001');
  });

  it('includes <counterpart> for a B2B doc', () => {
    const xml = buildInvoicesDocXml({
      issuerVat: '094000000', counterpartyVat: '803311450', issueDate: '2026-06-30', invoiceType: '2.1',
      lines: [{ lineNumber: 1, netValue: 50, vatCategory: 1, vatAmount: 12 }],
    });
    expect(xml).toContain('<counterpart><vatNumber>803311450</vatNumber>');
    expect(xml).toContain('<invoiceType>2.1</invoiceType>');
  });

  it('throws on an empty line set', () => {
    expect(() => buildInvoicesDocXml({ issuerVat: 'x', issueDate: '2026-06-30', invoiceType: '11.2', lines: [] })).toThrow();
  });
});

// ── SBZ adapter ─────────────────────────────────────────────────────────────
describe('providers/sbz — parseSbzResponse', () => {
  it('parses a success response (ΜΑΡΚ/UID/QR)', () => {
    const raw = `<ResponseDoc><response><statusCode>Success</statusCode><invoiceUid>ABCDEF</invoiceUid><invoiceMark>400001889685421</invoiceMark><authenticationCode>AUTH123</authenticationCode><qrUrl>https://mydata/qr/x</qrUrl></response></ResponseDoc>`;
    const r = parseSbzResponse(raw, 200);
    expect(r.ok).toBe(true);
    expect(r.mark).toBe('400001889685421');
    expect(r.uid).toBe('ABCDEF');
    expect(r.qrUrl).toBe('https://mydata/qr/x');
  });
  it('parses an error response as not-ok', () => {
    const raw = `<ResponseDoc><response><statusCode>ValidationFailed</statusCode><errors><error><code>236</code><message>Sender VAT must differ</message></error></errors></response></ResponseDoc>`;
    const r = parseSbzResponse(raw, 200);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toEqual({ code: '236', message: 'Sender VAT must differ' });
  });
});

describe('providers/sbz — submitInvoiceToSbz', () => {
  it('POSTs to the SBZ endpoint with the API-KEY header and parses', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fakeFetch: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200, text: async () => `<response><statusCode>Success</statusCode><invoiceMark>400002</invoiceMark></response>` };
    };
    const r = await submitInvoiceToSbz('<xml/>', { apiKey: 'k', baseUrl: 'https://demo', mode: 'production' }, fakeFetch);
    expect(r.ok).toBe(true);
    expect(r.mark).toBe('400002');
    expect(calls[0].url).toBe('https://demo/sign/sendinvoice.php?action=production');
    expect(calls[0].headers['API-KEY']).toBe('k');
  });
  it('returns a network_error result (never throws) on fetch failure', async () => {
    const r = await submitInvoiceToSbz('<xml/>', { apiKey: 'k', baseUrl: 'https://x', mode: 'sandbox' }, async () => { throw new Error('boom'); });
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe('network_error');
  });
});

// ── mappers ─────────────────────────────────────────────────────────────────
const ISSUER: IssuerInfo = { vat: '094000000', branch: 0, series: 'A', defaultClassification: null };

describe('invoicing.service — plan mappers', () => {
  it('planFromOffer maps NET items + offer vat_rate, picks 2.1 for a B2B counterparty', () => {
    const offer = { offer_number: 'OFFER-1', vat_rate: 24, subtotal: 100 } as OfferRow;
    const items = [{ description: 'Εργασία', quantity: 1, unit_price: 100, line_total: 100 } as OfferItemRow];
    const plan = planFromOffer(offer, items, ISSUER, { vat: '803311450', name: 'ΑΕ' });
    expect(plan.input.invoiceType).toBe('2.1');
    expect(plan.net).toBe(100);
    expect(plan.vat).toBe(24);
    expect(plan.total).toBe(124);
    expect(plan.input.lines[0].vatCategory).toBe(1);
  });
  it('planFromGross splits gross + picks 11.2 for B2C (no ΑΦΜ)', () => {
    const plan = planFromGross({ gross: 124, description: 'Προκαταβολή', vatRate: 24 }, ISSUER, { vat: null, name: 'Πελάτης' }, { paymentRequestId: 'pr1' }, 'pay:pr1');
    expect(plan.input.invoiceType).toBe('11.2');
    expect(plan.net).toBe(100);
    expect(plan.vat).toBe(24);
    expect(plan.dedupKey).toBe('pay:pr1');
  });
});

// ── issue flow (fake supabase + fake provider) ──────────────────────────────
function makeFakeSupabase(store: Record<string, Record<string, unknown>[]>) {
  let idc = 1000;
  const matches = (row: Record<string, unknown>, filters: [string, unknown][]) => filters.every(([c, v]) => row[c] === v);
  function build(table: string) {
    const st: { op: string; filters: [string, unknown][]; single: false | 'maybe' | 'single'; values: Record<string, unknown> | null } = { op: 'select', filters: [], single: false, values: null };
    let cached: unknown;
    let ran = false;
    const run = () => {
      if (ran) return cached; // memoize: await may invoke then() more than once
      ran = true;
      const rows = (store[table] ??= []);
      if (st.op === 'insert') {
        const row = { id: `id${idc++}`, ...st.values };
        rows.push(row);
        cached = { data: st.single ? row : [row], error: null };
      } else if (st.op === 'update') {
        const hit = rows.filter((r) => matches(r, st.filters));
        hit.forEach((r) => Object.assign(r, st.values));
        cached = { data: st.single ? (hit[0] ?? null) : hit, error: null };
      } else {
        const sel = rows.filter((r) => matches(r, st.filters));
        cached = { data: st.single ? (sel[0] ?? null) : sel, error: null };
      }
      return cached;
    };
    const api: Record<string, unknown> = {
      select: () => api, insert: (v: Record<string, unknown>) => { st.op = 'insert'; st.values = v; return api; },
      update: (v: Record<string, unknown>) => { st.op = 'update'; st.values = v; return api; },
      eq: (c: string, v: unknown) => { st.filters.push([c, v]); return api; },
      in: () => api, order: () => api, range: () => api,
      maybeSingle: () => { st.single = 'maybe'; return api; },
      single: () => { st.single = 'single'; return api; },
      then: (resolve: (r: unknown) => void) => resolve(run()),
    };
    return api;
  }
  return { from: (t: string) => build(t) } as never;
}

const SUCCESS = { ok: true, statusCode: 'Success', mark: '400009', uid: 'UID40', authenticationCode: 'AUTH', qrUrl: 'https://qr', errors: [] as { code: string; message: string }[], httpStatus: 200, rawResponse: '<ok/>' };
const mkOkSubmit = () => vi.fn(async () => ({ ...SUCCESS }));

describe('invoicing.service — issueInvoiceDocument', () => {
  const cfg = () => ({ apiKey: 'pk', baseUrl: 'https://demo', mode: 'production' as const });

  it('persists an issued invoice with the ΜΑΡΚ on success', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: true }], invoices: [] as Record<string, unknown>[] };
    const ctx = { businessId: 'biz1', userId: 'u1', role: 'owner', supabase: makeFakeSupabase(store) };
    const plan = planFromGross({ gross: 124, description: 'Υπηρεσία', vatRate: 24 }, ISSUER, { vat: null, name: 'Πελάτης' }, { paymentRequestId: 'pr1' }, 'pay:pr1');
    const submit = mkOkSubmit();
    const row = await issueInvoiceDocument(ctx as never, plan, { getConfig: cfg, submit: submit as never });
    expect(row.status).toBe('issued');
    expect(row.mark).toBe('400009');
    expect(store.invoices).toHaveLength(1);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('is idempotent on dedup_key (2nd issue returns the same invoice, no re-submit)', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: true }], invoices: [] as Record<string, unknown>[] };
    const ctx = { businessId: 'biz1', userId: 'u1', role: 'owner', supabase: makeFakeSupabase(store) };
    const plan = planFromGross({ gross: 124, description: 'x', vatRate: 24 }, ISSUER, { vat: null, name: null }, {}, 'pay:prDup');
    const submit = mkOkSubmit();
    const first = await issueInvoiceDocument(ctx as never, plan, { getConfig: cfg, submit: submit as never });
    const second = await issueInvoiceDocument(ctx as never, plan, { getConfig: cfg, submit: submit as never });
    expect(first.status).toBe('issued');
    expect(second.id).toBe(first.id);
    expect(submit).toHaveBeenCalledOnce();
    expect(store.invoices).toHaveLength(1);
  });

  it('throws invoicing_not_configured (503) when no provider config', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: true }], invoices: [] };
    const ctx = { businessId: 'biz1', userId: 'u1', role: 'owner', supabase: makeFakeSupabase(store) };
    const plan = planFromGross({ gross: 124, description: 'x', vatRate: 24 }, ISSUER, { vat: null, name: null });
    await expect(issueInvoiceDocument(ctx as never, plan, { getConfig: () => null })).rejects.toMatchObject({ code: 'invoicing_not_configured', status: 503 });
  });

  it('throws invoicing_not_enabled (409) when the tenant has not activated', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: false }], invoices: [] };
    const ctx = { businessId: 'biz1', userId: 'u1', role: 'owner', supabase: makeFakeSupabase(store) };
    const plan = planFromGross({ gross: 124, description: 'x', vatRate: 24 }, ISSUER, { vat: null, name: null });
    await expect(issueInvoiceDocument(ctx as never, plan, { getConfig: cfg, submit: mkOkSubmit() as never })).rejects.toMatchObject({ code: 'invoicing_not_enabled', status: 409 });
  });

  it('marks the invoice failed when the provider rejects', async () => {
    const store = { business_invoicing_settings: [{ id: 's1', business_id: 'biz1', enabled: true }], invoices: [] as Record<string, unknown>[] };
    const ctx = { businessId: 'biz1', userId: 'u1', role: 'owner', supabase: makeFakeSupabase(store) };
    const plan = planFromGross({ gross: 124, description: 'x', vatRate: 24 }, ISSUER, { vat: null, name: null }, {}, 'pay:prX');
    const submit = vi.fn(async () => ({ ok: false, statusCode: 'ValidationFailed', mark: null, uid: null, authenticationCode: null, qrUrl: null, errors: [{ code: '236', message: 'bad' }], httpStatus: 200, rawResponse: '<e/>' }));
    const row = await issueInvoiceDocument(ctx as never, plan, { getConfig: cfg, submit: submit as never });
    expect(row.status).toBe('failed');
    expect(row.error).toContain('236');
  });
});
