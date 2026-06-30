// myDATA InvoicesDoc XML builder (AADE spec v2.0.1).
//
// Builds the `InvoicesDoc` document the provider (SBZ) forwards to AADE on
// SendInvoices. Pure + deterministic (no I/O) → fully unit-testable.
//
// ⚠️ SANDBOX-CONFIRM: the AADE namespaces, the income-classification category
// codes, the `paymentMethods` type enumeration, and whether the provider wants
// `series`/`aa` supplied-by-us vs assigned-by-them are validated against the SBZ
// demo environment + the official InvoicesDoc.xsd v2.0.1 before going live. The
// structure below follows the published AADE schema; the exact classification
// codes per business activity are owner/accountant input (see blocked_on).

export interface MyDataLine {
  lineNumber: number;
  /** NET value (pre-VAT). */
  netValue: number;
  /** myDATA vatCategory code (1=24%,2=13%,3=6%,7=0%,8=without VAT). */
  vatCategory: number;
  vatAmount: number;
  /** E3 income classification, e.g. 'E3_561_001' (services). */
  incomeClassificationType?: string;
  /** classificationCategory, e.g. 'category1_3' (provision of services). */
  incomeClassificationCategory?: string;
}

export interface MyDataInvoiceInput {
  issuerVat: string;
  issuerBranch?: number;
  issuerCountry?: string; // ISO-2, default GR
  counterpartyVat?: string | null; // present → B2B; absent → retail (B2C)
  counterpartyCountry?: string;
  counterpartyBranch?: number;
  series?: string | null;
  aa?: string | null;
  issueDate: string; // YYYY-MM-DD
  invoiceType: string; // '2.1' | '11.2' | ...
  currency?: string; // default EUR
  lines: MyDataLine[];
  /** myDATA paymentMethod type (3 = bank transfer, 1 = cash, ...). */
  paymentMethodType?: number;
  paymentAmount?: number;
}

const AADE_NS = 'http://www.aade.gr/myDATA/invoice/v1.0';
const ICLS_NS = 'https://www.aade.gr/myDATA/incomeClassificaton/v1.0';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number): string => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);

function classificationXml(type: string | undefined, category: string | undefined, amount: number): string {
  if (!type) return '';
  const cat = category ? `<icls:classificationCategory>${esc(category)}</icls:classificationCategory>` : '';
  return (
    `<incomeClassification>` +
    `<icls:classificationType>${esc(type)}</icls:classificationType>` +
    cat +
    `<icls:amount>${money(amount)}</icls:amount>` +
    `</incomeClassification>`
  );
}

/** Build the InvoicesDoc XML for a single invoice. Throws on an empty line set. */
export function buildInvoicesDocXml(input: MyDataInvoiceInput): string {
  if (!input.lines || input.lines.length === 0) throw new Error('invoice has no lines');

  const issuerCountry = input.issuerCountry ?? 'GR';
  const currency = input.currency ?? 'EUR';

  const totalNet = input.lines.reduce((s, l) => s + l.netValue, 0);
  const totalVat = input.lines.reduce((s, l) => s + l.vatAmount, 0);
  const totalGross = totalNet + totalVat;

  const issuer =
    `<issuer><vatNumber>${esc(input.issuerVat)}</vatNumber>` +
    `<country>${esc(issuerCountry)}</country>` +
    `<branch>${input.issuerBranch ?? 0}</branch></issuer>`;

  const counterpart = input.counterpartyVat
    ? `<counterpart><vatNumber>${esc(input.counterpartyVat)}</vatNumber>` +
      `<country>${esc(input.counterpartyCountry ?? 'GR')}</country>` +
      `<branch>${input.counterpartyBranch ?? 0}</branch></counterpart>`
    : '';

  const header =
    `<invoiceHeader>` +
    (input.series ? `<series>${esc(input.series)}</series>` : '') +
    (input.aa ? `<aa>${esc(input.aa)}</aa>` : '') +
    `<issueDate>${esc(input.issueDate)}</issueDate>` +
    `<invoiceType>${esc(input.invoiceType)}</invoiceType>` +
    `<currency>${esc(currency)}</currency>` +
    `</invoiceHeader>`;

  const payment =
    input.paymentMethodType != null
      ? `<paymentMethods><paymentMethodDetails>` +
        `<type>${input.paymentMethodType}</type>` +
        `<amount>${money(input.paymentAmount ?? totalGross)}</amount>` +
        `</paymentMethodDetails></paymentMethods>`
      : '';

  const details = input.lines
    .map(
      (l) =>
        `<invoiceDetails>` +
        `<lineNumber>${l.lineNumber}</lineNumber>` +
        `<netValue>${money(l.netValue)}</netValue>` +
        `<vatCategory>${l.vatCategory}</vatCategory>` +
        `<vatAmount>${money(l.vatAmount)}</vatAmount>` +
        classificationXml(l.incomeClassificationType, l.incomeClassificationCategory, l.netValue) +
        `</invoiceDetails>`
    )
    .join('');

  // Summary-level income classification aggregates the lines that carry one.
  const summaryClassType = input.lines.find((l) => l.incomeClassificationType)?.incomeClassificationType;
  const summaryClassCat = input.lines.find((l) => l.incomeClassificationType)?.incomeClassificationCategory;
  const summaryClassAmount = input.lines
    .filter((l) => l.incomeClassificationType)
    .reduce((s, l) => s + l.netValue, 0);

  const summary =
    `<invoiceSummary>` +
    `<totalNetValue>${money(totalNet)}</totalNetValue>` +
    `<totalVatAmount>${money(totalVat)}</totalVatAmount>` +
    `<totalWithheldAmount>0.00</totalWithheldAmount>` +
    `<totalFeesAmount>0.00</totalFeesAmount>` +
    `<totalStampDutyAmount>0.00</totalStampDutyAmount>` +
    `<totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>` +
    `<totalDeductionsAmount>0.00</totalDeductionsAmount>` +
    `<totalGrossValue>${money(totalGross)}</totalGrossValue>` +
    classificationXml(summaryClassType, summaryClassCat, summaryClassAmount) +
    `</invoiceSummary>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<InvoicesDoc xmlns="${AADE_NS}" xmlns:icls="${ICLS_NS}">` +
    `<invoice>${issuer}${counterpart}${header}${payment}${details}${summary}</invoice>` +
    `</InvoicesDoc>`
  );
}
