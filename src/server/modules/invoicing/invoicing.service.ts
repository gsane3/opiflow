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
import type { InvoiceLineItem, InvoiceRow } from './types';
import type { OfferRow, OfferItemRow } from '../offers/offers.types';

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
  const result = await submit(xml, config, { issuerVat: plan.input.issuerVat }, fetchImpl);

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
