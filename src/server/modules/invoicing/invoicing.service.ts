// Invoicing service — orchestrates issuing a myDATA document: map source data →
// InvoicesDoc input, persist a draft, transmit via the provider, store ΜΑΡΚ/QR.
// All I/O (provider fetch, config) is injectable for tests. Nothing here is wired
// to a route/AI/payment yet — that is PR3/PR4/PR5.

import { AppError } from '../../core/errors';
import { getSbzConfig, type SbzConfig } from './invoicing.config';
import { buildInvoicesDocXml, type MyDataInvoiceInput, type MyDataLine } from './mydata-xml';
import { submitInvoiceToSbz, type FetchLike } from './providers/sbz';
import * as repo from './invoicing.repo';
import type { RepoContext } from './invoicing.repo';
import { splitGrossToNetVat, vatCategoryForRate, pickServiceInvoiceType } from './invoicing.logic';
import type { InvoiceLineItem, InvoiceRow, InvoicingSettingsRow } from './types';
import type { OfferRow, OfferItemRow } from '../offers/offers.types';
import { getOfferRowById, fetchItemsForOffer } from '../offers/offers.repo';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const today = (): string => new Date().toISOString().slice(0, 10);
const DEFAULT_CLASSIFICATION_TYPE = 'E3_561_001'; // services revenue (confirm per activity)
const DEFAULT_CLASSIFICATION_CATEGORY = 'category1_3'; // provision of services

export interface IssuerInfo {
  vat: string;
  branch: number;
  series: string | null;
  defaultClassification: string | null;
}
export interface CounterpartyInfo {
  vat: string | null;
  name: string | null;
}

export interface InvoicePlan {
  input: MyDataInvoiceInput;
  storedLines: InvoiceLineItem[];
  counterpartyVat: string | null;
  counterpartyName: string | null;
  net: number;
  vat: number;
  total: number;
  linkage: {
    customerId?: string | null;
    workFolderId?: string | null;
    offerId?: string | null;
    paymentRequestId?: string | null;
  };
  dedupKey?: string;
}

function classificationFor(issuer: IssuerInfo): { type: string; category: string } {
  return {
    type: issuer.defaultClassification || DEFAULT_CLASSIFICATION_TYPE,
    category: DEFAULT_CLASSIFICATION_CATEGORY,
  };
}

/** Build an invoice plan from an OFFER (items are NET; one vat_rate for the offer). */
export function planFromOffer(
  offer: OfferRow,
  items: OfferItemRow[],
  issuer: IssuerInfo,
  counterparty: CounterpartyInfo,
  linkage: InvoicePlan['linkage'] = {}
): InvoicePlan {
  const cls = classificationFor(issuer);
  const vatRate = offer.vat_rate ?? 24;
  const vatCategory = vatCategoryForRate(vatRate);
  const source = items.length > 0 ? items : [{ description: offer.offer_number, quantity: 1, unit_price: offer.subtotal, line_total: offer.subtotal } as OfferItemRow];

  const storedLines: InvoiceLineItem[] = [];
  const lines: MyDataLine[] = [];
  source.forEach((it, i) => {
    const net = round2(it.line_total);
    const vat = round2((net * vatRate) / 100);
    storedLines.push({ description: it.description, quantity: it.quantity, unitNet: round2(it.unit_price), vatRate, netAmount: net, vatAmount: vat, incomeClassification: cls.type });
    lines.push({ lineNumber: i + 1, netValue: net, vatCategory, vatAmount: vat, incomeClassificationType: cls.type, incomeClassificationCategory: cls.category });
  });

  const net = round2(storedLines.reduce((s, l) => s + l.netAmount, 0));
  const vat = round2(storedLines.reduce((s, l) => s + l.vatAmount, 0));
  return {
    input: {
      issuerVat: issuer.vat,
      issuerBranch: issuer.branch,
      counterpartyVat: counterparty.vat || undefined,
      series: issuer.series,
      issueDate: today(),
      invoiceType: pickServiceInvoiceType(counterparty.vat),
      currency: 'EUR',
      lines,
      paymentMethodType: 3, // bank transfer
    },
    storedLines,
    counterpartyVat: counterparty.vat,
    counterpartyName: counterparty.name,
    net,
    vat,
    total: round2(net + vat),
    linkage,
  };
}

/** Build an invoice plan from a single GROSS amount (e.g. a confirmed payment). */
export function planFromGross(
  args: { gross: number; description: string; vatRate: number },
  issuer: IssuerInfo,
  counterparty: CounterpartyInfo,
  linkage: InvoicePlan['linkage'] = {},
  dedupKey?: string
): InvoicePlan {
  const cls = classificationFor(issuer);
  const { net, vat } = splitGrossToNetVat(args.gross, args.vatRate);
  const vatCategory = vatCategoryForRate(args.vatRate);
  const storedLines: InvoiceLineItem[] = [
    { description: args.description, quantity: 1, unitNet: net, vatRate: args.vatRate, netAmount: net, vatAmount: vat, incomeClassification: cls.type },
  ];
  return {
    input: {
      issuerVat: issuer.vat,
      issuerBranch: issuer.branch,
      counterpartyVat: counterparty.vat || undefined,
      series: issuer.series,
      issueDate: today(),
      invoiceType: pickServiceInvoiceType(counterparty.vat),
      currency: 'EUR',
      lines: [{ lineNumber: 1, netValue: net, vatCategory, vatAmount: vat, incomeClassificationType: cls.type, incomeClassificationCategory: cls.category }],
      paymentMethodType: 3,
    },
    storedLines,
    counterpartyVat: counterparty.vat,
    counterpartyName: counterparty.name,
    net,
    vat,
    total: round2(net + vat),
    linkage,
    dedupKey,
  };
}

export interface IssueDeps {
  getConfig?: () => SbzConfig | null;
  submit?: typeof submitInvoiceToSbz;
  fetchImpl?: FetchLike;
}

/**
 * Issue (transmit) one invoice plan. Idempotent on plan.dedupKey: if an invoice
 * with that key already exists, returns it instead of re-issuing. Persists a
 * 'submitting' draft, transmits, then flips to 'issued' (with ΜΑΡΚ/UID/QR) or
 * 'failed' (with the provider error). Throws AppError when invoicing is not
 * configured (503) or not enabled for this tenant (409).
 */
export async function issueInvoiceDocument(ctx: RepoContext, plan: InvoicePlan, deps: IssueDeps = {}): Promise<InvoiceRow> {
  const config = (deps.getConfig ?? getSbzConfig)();
  if (!config) throw new AppError('invoicing_not_configured', 503);

  const settings = await repo.getInvoicingSettings(ctx);
  if (!settings || !settings.enabled) throw new AppError('invoicing_not_enabled', 409);

  if (plan.dedupKey) {
    const existing = await repo.findInvoiceByDedup(ctx, plan.dedupKey);
    if (existing) return existing;
  }

  const xml = buildInvoicesDocXml(plan.input);

  const draft = await repo.createInvoice(ctx, {
    customer_id: plan.linkage.customerId ?? null,
    work_folder_id: plan.linkage.workFolderId ?? null,
    offer_id: plan.linkage.offerId ?? null,
    payment_request_id: plan.linkage.paymentRequestId ?? null,
    provider: 'sbz',
    invoice_type: plan.input.invoiceType,
    series: plan.input.series ?? null,
    issue_date: plan.input.issueDate,
    counterparty_vat: plan.counterpartyVat,
    counterparty_name: plan.counterpartyName,
    currency: 'EUR',
    net_amount: plan.net,
    vat_amount: plan.vat,
    total_amount: plan.total,
    line_items: plan.storedLines,
    status: 'submitting',
    dedup_key: plan.dedupKey ?? null,
    provider_request: { xml },
  });

  const submit = deps.submit ?? submitInvoiceToSbz;
  const fetchImpl = deps.fetchImpl ?? ((globalThis as { fetch?: FetchLike }).fetch as FetchLike);
  const result = await submit(xml, config, fetchImpl);

  const providerResponse = {
    statusCode: result.statusCode,
    httpStatus: result.httpStatus,
    errors: result.errors,
    raw: result.rawResponse.slice(0, 4000),
  };

  if (result.ok && result.mark) {
    const updated = await repo.updateInvoice(ctx, draft.id, {
      status: 'issued',
      mark: result.mark,
      uid: result.uid,
      authentication_code: result.authenticationCode,
      qr_url: result.qrUrl,
      provider_response: providerResponse,
      issued_at: new Date().toISOString(),
      error: null,
    });
    return updated ?? draft;
  }

  const errMsg = result.errors.map((e) => `${e.code}: ${e.message}`).join('; ') || `http ${result.httpStatus}`;
  const updated = await repo.updateInvoice(ctx, draft.id, {
    status: 'failed',
    provider_response: providerResponse,
    error: errMsg,
  });
  return updated ?? draft;
}

// ── Route-facing orchestration ───────────────────────────────────────────────

/** Build the issuer from the per-tenant settings. Throws if the issuer ΑΦΜ is not
 *  set yet (snapshotted at activation; settable via PUT /settings). */
function issuerFromSettings(settings: InvoicingSettingsRow): IssuerInfo {
  if (!settings.issuer_vat) throw new AppError('issuer_vat_missing', 400);
  return {
    vat: settings.issuer_vat,
    branch: settings.issuer_branch,
    series: settings.invoice_series,
    defaultClassification: settings.default_income_classification,
  };
}

async function loadCounterparty(
  ctx: RepoContext,
  customerId: string | null,
  vatOverride: string | null
): Promise<CounterpartyInfo> {
  if (!customerId) return { vat: vatOverride, name: null };
  const c = await repo.getCustomerForInvoice(ctx, customerId);
  // Explicit override wins; otherwise use the customer's stored ΑΦΜ (migration 067).
  // A valid ΑΦΜ → B2B service invoice (2.1); none → B2C retail receipt (11.2).
  return { vat: vatOverride ?? c?.vatNumber ?? null, name: c?.companyName || c?.name || null };
}

/** Issue an invoice for an existing offer (items NET; one offer vat_rate). Idempotent per offer. */
export async function issueForOffer(ctx: RepoContext, offerId: string, deps: IssueDeps = {}): Promise<InvoiceRow> {
  const settings = await repo.getInvoicingSettings(ctx);
  if (!settings || !settings.enabled) throw new AppError('invoicing_not_enabled', 409);
  const issuer = issuerFromSettings(settings);
  const offer = await getOfferRowById(ctx, offerId);
  if (!offer) throw new AppError('offer_not_found', 404);
  const items = await fetchItemsForOffer(ctx, offerId);
  const counterparty = await loadCounterparty(ctx, offer.customer_id, null);
  const plan = planFromOffer(offer, items, issuer, counterparty, { customerId: offer.customer_id, offerId });
  plan.dedupKey = `offer:${offerId}`;
  return issueInvoiceDocument(ctx, plan, deps);
}

/**
 * Auto-issue an invoice when a payment is CONFIRMED. Best-effort + fully gated:
 * no-op unless the provider env is set AND the tenant enabled both invoicing and
 * auto_issue_on_payment. Idempotent per payment (dedup_key 'pay:<id>'). Swallows
 * all errors — must NEVER affect the payment-confirm flow (called fire-and-forget).
 * `row` is the raw PaymentRequestRow (has amount [GROSS], customer_id, offer_id, kind).
 */
export async function autoIssueInvoiceForPayment(
  ctx: RepoContext,
  row: { id: string; amount: number; customer_id: string | null; offer_id: string | null; kind: string },
  deps: IssueDeps = {}
): Promise<InvoiceRow | null> {
  try {
    if (!(deps.getConfig ?? getSbzConfig)()) return null;
    const settings = await repo.getInvoicingSettings(ctx);
    if (!settings || !settings.enabled || !settings.auto_issue_on_payment) return null;

    let vatRate = 24;
    if (row.offer_id) {
      const offer = await getOfferRowById(ctx, row.offer_id);
      if (offer?.vat_rate != null) vatRate = offer.vat_rate;
    }
    const description = row.kind === 'deposit' ? 'Προκαταβολή' : 'Εξόφληση';
    return await issueManualGross(
      ctx,
      { gross: row.amount, vatRate, description, customerId: row.customer_id, dedupKey: `pay:${row.id}` },
      deps
    );
  } catch {
    return null; // best-effort; never throws into the payment-confirm path
  }
}

/** Issue an ad-hoc invoice from a GROSS amount (e.g. a confirmed payment or manual entry). */
export async function issueManualGross(
  ctx: RepoContext,
  args: { gross: number; vatRate: number; description: string; customerId?: string | null; counterpartyVat?: string | null; dedupKey?: string },
  deps: IssueDeps = {}
): Promise<InvoiceRow> {
  const settings = await repo.getInvoicingSettings(ctx);
  if (!settings || !settings.enabled) throw new AppError('invoicing_not_enabled', 409);
  const issuer = issuerFromSettings(settings);
  const counterparty = await loadCounterparty(ctx, args.customerId ?? null, args.counterpartyVat ?? null);
  const plan = planFromGross(
    { gross: args.gross, description: args.description, vatRate: args.vatRate },
    issuer,
    counterparty,
    { customerId: args.customerId ?? null },
    args.dedupKey
  );
  return issueInvoiceDocument(ctx, plan, deps);
}
