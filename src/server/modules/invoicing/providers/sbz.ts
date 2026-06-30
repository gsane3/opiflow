// SBZ provider adapter — transmits an InvoicesDoc to myDATA via SBZ's licensed
// REST API and parses the returned ΜΑΡΚ / UID / QR.
//
// Auth (per the AADE provider API + SBZ docs): the partner sends ONE credential
// pair in headers (aade-user-id + ocp-apim-subscription-key); each document's
// issuer is identified by issuervat (Sender VAT must differ from issuer VAT).
//
// ⚠️ SANDBOX-CONFIRM against the SBZ demo environment: the exact send path
// (`/SendInvoices` here), whether issuervat goes in a header vs only in the XML,
// and the precise response element names. The parser tolerates both the AADE
// ResponseDoc shape and minor SBZ variations (regex, namespace-agnostic).
//
// I/O is injected (fetchImpl) so the whole flow is unit-testable without network.

import type { SbzConfig } from '../invoicing.config';

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchLikeResponse>;

export interface SbzSubmitResult {
  ok: boolean;
  statusCode: string | null;
  mark: string | null;
  uid: string | null;
  authenticationCode: string | null;
  qrUrl: string | null;
  errors: { code: string; message: string }[];
  httpStatus: number;
  rawResponse: string;
}

// (The issuer VAT travels inside the InvoicesDoc XML; no per-call options needed.)

// Namespace-agnostic single-tag extractor: matches <tag ...>value</tag> or <ns:tag>value</ns:tag>.
function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function parseErrors(xml: string): { code: string; message: string }[] {
  const out: { code: string; message: string }[] = [];
  const blocks = xml.match(/<(?:[\w.-]+:)?error\b[\s\S]*?<\/(?:[\w.-]+:)?error>/gi) ?? [];
  for (const b of blocks) {
    out.push({ code: tag(b, 'code') ?? '', message: tag(b, 'message') ?? '' });
  }
  return out;
}

/** Parse an AADE/SBZ ResponseDoc into a normalized result. */
export function parseSbzResponse(rawResponse: string, httpStatus: number): SbzSubmitResult {
  const statusCode = tag(rawResponse, 'statusCode');
  const mark = tag(rawResponse, 'invoiceMark');
  const uid = tag(rawResponse, 'invoiceUid');
  const authenticationCode = tag(rawResponse, 'authenticationCode');
  // SBZ returns InvoiceUrl + myDATAUrl; the AADE/QR link is the myDATA one.
  const qrUrl = tag(rawResponse, 'qrUrl') ?? tag(rawResponse, 'myDATAUrl') ?? tag(rawResponse, 'invoiceUrl') ?? tag(rawResponse, 'url');
  const errors = parseErrors(rawResponse);
  const ok =
    httpStatus >= 200 &&
    httpStatus < 300 &&
    !!mark &&
    errors.length === 0 &&
    (statusCode == null || /success/i.test(statusCode));
  return { ok, statusCode, mark, uid, authenticationCode, qrUrl, errors, httpStatus, rawResponse };
}

/** POST an InvoicesDoc XML to SBZ and return the parsed result. Never throws on a
 *  non-2xx HTTP — the caller maps {ok:false, errors} to a failed invoice row.
 *  Endpoint + headers per the SBZ REST docs:
 *    POST {baseUrl}/sign/sendinvoice.php?action={production|sandbox}
 *    headers: API-KEY, Content-Type: application/xml; charset=utf-8 */
export async function submitInvoiceToSbz(
  xml: string,
  config: SbzConfig,
  fetchImpl: FetchLike
): Promise<SbzSubmitResult> {
  const url = `${config.baseUrl}/sign/sendinvoice.php?action=${config.mode}`;
  let res: FetchLikeResponse;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'API-KEY': config.apiKey,
      },
      body: xml,
    });
  } catch (err) {
    return {
      ok: false, statusCode: null, mark: null, uid: null, authenticationCode: null, qrUrl: null,
      errors: [{ code: 'network_error', message: err instanceof Error ? err.message : 'fetch failed' }],
      httpStatus: 0, rawResponse: '',
    };
  }
  const body = await res.text();
  return parseSbzResponse(body, res.status);
}
