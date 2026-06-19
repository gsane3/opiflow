// ---------------------------------------------------------------------------
// Apifon SMS gateway integration.
//
// Mirrors the OAuth + result-shape conventions of `apifon-viber.ts`. The token
// logic is duplicated here intentionally (the Viber module keeps its OAuth
// private) so this module stays self-contained and env-safe: when the Apifon
// credentials are not configured, every call is a safe no-op returning
// `{ ok: false, skipped: true, reason: 'missing_apifon_config' }`.
//
// The exact field names accepted by the Apifon SMS endpoint can vary slightly
// between accounts; this request is intentionally minimal and the full response
// body is surfaced in the result so it can be tuned after a live test.
// ---------------------------------------------------------------------------

const DEFAULT_APIFON_BASE_URL = 'https://ars.apifon.com';
const APIFON_SMS_SEND_PATH = '/services/api/v1/sms/send';

interface ApifonSmsConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  senderId: string;
}

interface ApifonTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface ApifonSmsSubscriber {
  number: string;
  custom_id?: string;
}

interface ApifonSmsChannel {
  sender_id: string;
  text: string;
}

interface ApifonSmsSendRequest {
  subscribers: ApifonSmsSubscriber[];
  reference_id?: string;
  sms: ApifonSmsChannel;
}

export interface SendSmsMessageParams {
  phone: string | null;
  text: string;
  customerId?: string | null;
  referenceId?: string | null;
}

export type SendSmsResult =
  | {
      ok: true;
      skipped: false;
      responseStatus: number;
      requestId: string | null;
      messageId: string | null;
    }
  | {
      ok: false;
      skipped: true;
      reason: 'missing_apifon_config' | 'missing_or_invalid_phone';
    }
  | {
      ok: false;
      skipped: false;
      responseStatus: number | null;
      error: string;
      responseBody?: unknown;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normaliseBaseUrl(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_APIFON_BASE_URL;
  return value.replace(/\/$/, '');
}

function getApifonSmsConfig(): ApifonSmsConfig | null {
  const clientId = process.env.APIFON_CLIENT_ID?.trim();
  const clientSecret = process.env.APIFON_API_KEY?.trim();
  const senderId =
    process.env.APIFON_SMS_SENDER?.trim() || process.env.APIFON_SENDER_ID?.trim();

  if (!clientId || !clientSecret || !senderId) {
    return null;
  }

  return {
    baseUrl: normaliseBaseUrl(process.env.APIFON_BASE_URL),
    clientId,
    clientSecret,
    senderId,
  };
}

/**
 * Normalise a raw phone number into an MSISDN suitable for Apifon.
 *
 * Mirrors the normalisation in `apifon-viber.ts`: strips non-digits and prefixes
 * bare 10-digit Greek mobile/landline numbers with the `30` country code.
 */
export function normalizeApifonMsisdn(rawPhone: string | null): string | null {
  if (!rawPhone) return null;

  const digits = rawPhone.replace(/[^\d]/g, '');
  if (!digits) return null;

  let normalized = digits;
  if (/^[26]\d{9}$/.test(digits)) {
    normalized = `30${digits}`;
  }

  if (!/^[1-9]\d{6,14}$/.test(normalized)) {
    return null;
  }

  return normalized;
}

// Diagnostic for the owner's live test: Apifon's own rejection reason (sender not
// approved / scope not granted / no credit / bad request) surfaces in the server
// logs. We deliberately log ONLY Apifon's response — never the recipient number
// or the message text (privacy). Truncated so a huge body can't flood the logs.
function logSmsFailure(detail: { responseStatus: number | null; error: string; responseBody?: unknown }): void {
  let body = '';
  try {
    body = detail.responseBody != null ? JSON.stringify(detail.responseBody).slice(0, 500) : '';
  } catch {
    body = '';
  }
  console.warn(`[apifon-sms] send failed status=${detail.responseStatus ?? 'n/a'} error=${detail.error}${body ? ` body=${body}` : ''}`);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 1000) };
  }
}

function getFirstResultObject(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body)) return null;

  const result = body['result'];
  if (Array.isArray(result) && result.length > 0 && isRecord(result[0])) {
    return result[0];
  }

  const data = body['data'];
  if (Array.isArray(data) && data.length > 0 && isRecord(data[0])) {
    return data[0];
  }

  return null;
}

function extractRequestId(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return getString(body['request_id']) ?? getString(body['requestId']);
}

function extractMessageId(body: unknown): string | null {
  const first = getFirstResultObject(body);
  if (!first) return null;

  return getString(first['message_id']) ?? getString(first['messageId']);
}

async function getApifonAccessToken(config: ApifonSmsConfig): Promise<string> {
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', config.clientId);
  body.set('client_secret', config.clientSecret);
  body.set('scope', 'accountInfo smsGateway');

  const response = await fetch('https://ids.apifon.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await response.text();
  let parsed: ApifonTokenResponse | null = null;

  if (text) {
    try {
      parsed = JSON.parse(text) as ApifonTokenResponse;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok || !parsed?.access_token) {
    const error = parsed?.error_description || parsed?.error || 'apifon_oauth_failed';
    throw new Error(error);
  }

  return parsed.access_token;
}

/**
 * Send a plain SMS message via the Apifon SMS gateway.
 *
 * Env-gated and non-throwing: returns a structured result in all cases.
 */
export async function sendSmsMessage(params: SendSmsMessageParams): Promise<SendSmsResult> {
  const config = getApifonSmsConfig();
  if (!config) {
    return { ok: false, skipped: true, reason: 'missing_apifon_config' };
  }

  const msisdn = normalizeApifonMsisdn(params.phone);
  if (!msisdn) {
    return { ok: false, skipped: true, reason: 'missing_or_invalid_phone' };
  }

  let refId: string | undefined;
  if (params.referenceId?.trim()) {
    refId = params.referenceId.trim().slice(0, 255);
  } else if (params.customerId) {
    refId = `sms:${params.customerId}`.slice(0, 255);
  }

  const subscriber: ApifonSmsSubscriber = { number: msisdn };
  if (params.customerId) {
    subscriber.custom_id = params.customerId;
  }

  const requestBody: ApifonSmsSendRequest = {
    subscribers: [subscriber],
    sms: {
      sender_id: config.senderId,
      text: params.text,
    },
  };

  if (refId) {
    requestBody.reference_id = refId;
  }

  const endpoint = `${config.baseUrl}${APIFON_SMS_SEND_PATH}`;

  try {
    const accessToken = await getApifonAccessToken(config);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
      logSmsFailure({ responseStatus: response.status, error: 'apifon_sms_send_failed', responseBody });
      return {
        ok: false,
        skipped: false,
        responseStatus: response.status,
        error: 'apifon_sms_send_failed',
        responseBody,
      };
    }

    return {
      ok: true,
      skipped: false,
      responseStatus: response.status,
      requestId: extractRequestId(responseBody),
      messageId: extractMessageId(responseBody),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'apifon_sms_send_failed';
    logSmsFailure({ responseStatus: null, error });
    return {
      ok: false,
      skipped: false,
      responseStatus: null,
      error,
    };
  }
}
