import { getPublicAppUrl } from './intake-tokens';

const DEFAULT_APIFON_BASE_URL = 'https://ars.apifon.com';
const APIFON_IM_SEND_PATH = '/services/api/v1/im/send';
const DEFAULT_VIBER_TTL_SECONDS = 86400;

interface ApifonConfig {
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

interface ApifonSubscriber {
  number: string;
  custom_id?: string;
}

interface ApifonAction {
  title: string;
  target_url: string;
}

interface ApifonImChannel {
  sender_id: string;
  text: string;
  actions?: ApifonAction[];
  ttl?: number;
}

interface ApifonImSendRequest {
  subscribers: ApifonSubscriber[];
  reference_id?: string;
  callback_url?: string;
  im_channels: ApifonImChannel[];
}

export interface SendIntakeViberParams {
  phone: string | null;
  intakeUrl: string;
  customerId: string;
  tokenId?: string | null;
  referenceId?: string | null;
  messageText?: string | null;
}

export type SendIntakeViberResult =
  | {
      ok: true;
      skipped: false;
      responseStatus: number;
      responseBody: unknown;
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
      responseBody: unknown;
      error: string;
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

function getApifonConfig(): ApifonConfig | null {
  const clientId = process.env.APIFON_CLIENT_ID?.trim();
  const clientSecret = process.env.APIFON_API_KEY?.trim();
  const senderId =
    process.env.APIFON_VIBER_SENDER_ID?.trim() ||
    process.env.APIFON_SENDER_ID?.trim();

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

function buildReferenceId(params: SendIntakeViberParams): string {
  const raw =
    params.referenceId?.trim() ||
    (params.tokenId ? `intake:${params.customerId}:${params.tokenId}` : `intake:${params.customerId}`);

  return raw.slice(0, 255);
}

export function buildIntakeViberText(intakeUrl: string): string {
  return [
    'Γεια σας.',
    'Για να ολοκληρώσουμε την καρτέλα σας, συμπληρώστε τα στοιχεία σας εδώ:',
    intakeUrl,
  ].join(' ');
}

function buildApifonStatusCallbackUrl(): string | null {
  const publicAppUrl = getPublicAppUrl();

  if (!publicAppUrl.startsWith('https://')) {
    return null;
  }

  const url = new URL('/api/webhooks/apifon/status', publicAppUrl);
  const secret = process.env.APIFON_WEBHOOK_SECRET?.trim();

  if (secret) {
    url.searchParams.set('secret', secret);
  }

  return url.toString();
}

// See apifon-sms.ts: logs ONLY Apifon's own rejection reason (never the recipient
// number or message text) so a live test is diagnosable from the server logs.
function logViberFailure(detail: { responseStatus: number | null; error: string; responseBody?: unknown }): void {
  let body = '';
  try {
    body = detail.responseBody != null ? JSON.stringify(detail.responseBody).slice(0, 500) : '';
  } catch {
    body = '';
  }
  console.warn(`[apifon-viber] send failed status=${detail.responseStatus ?? 'n/a'} error=${detail.error}${body ? ` body=${body}` : ''}`);
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

async function getApifonAccessToken(config: ApifonConfig): Promise<string> {
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', config.clientId);
  body.set('client_secret', config.clientSecret);
  body.set('scope', 'accountInfo imGateway');

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

function buildApifonRequest(
  config: ApifonConfig,
  params: SendIntakeViberParams,
  msisdn: string
): ApifonImSendRequest {
  const callbackUrl = buildApifonStatusCallbackUrl();

  const requestBody: ApifonImSendRequest = {
    subscribers: [
      {
        number: msisdn,
        custom_id: params.customerId,
      },
    ],
    reference_id: buildReferenceId(params),
    im_channels: [
      {
        sender_id: config.senderId,
        text: params.messageText?.trim() || buildIntakeViberText(params.intakeUrl),
        actions: [
          {
            title: 'Συμπλήρωση',
            target_url: params.intakeUrl,
          },
        ],
        ttl: DEFAULT_VIBER_TTL_SECONDS,
      },
    ],
  };

  if (callbackUrl) {
    requestBody.callback_url = callbackUrl;
  }

  return requestBody;
}

export async function sendIntakeViberMessage(
  params: SendIntakeViberParams
): Promise<SendIntakeViberResult> {
  const config = getApifonConfig();
  if (!config) {
    return { ok: false, skipped: true, reason: 'missing_apifon_config' };
  }

  const msisdn = normalizeApifonMsisdn(params.phone);
  if (!msisdn) {
    return { ok: false, skipped: true, reason: 'missing_or_invalid_phone' };
  }

  const endpoint = `${config.baseUrl}${APIFON_IM_SEND_PATH}`;
  const requestBody = buildApifonRequest(config, params, msisdn);

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
      logViberFailure({ responseStatus: response.status, error: 'apifon_send_failed', responseBody });
      return {
        ok: false,
        skipped: false,
        responseStatus: response.status,
        responseBody,
        error: 'apifon_send_failed',
      };
    }

    return {
      ok: true,
      skipped: false,
      responseStatus: response.status,
      responseBody,
      requestId: extractRequestId(responseBody),
      messageId: extractMessageId(responseBody),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'apifon_send_failed';
    logViberFailure({ responseStatus: null, error });
    return {
      ok: false,
      skipped: false,
      responseStatus: null,
      responseBody: null,
      error,
    };
  }
}

// ---------------------------------------------------------------------------
// Generic Viber text message (appointment notifications and other non-intake uses)
// ---------------------------------------------------------------------------

export interface SendViberMessageParams {
  phone: string | null;
  text: string;
  customerId?: string | null;
  referenceId?: string | null;
}

export type SendViberMessageResult =
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
    };

export async function sendViberMessage(
  params: SendViberMessageParams
): Promise<SendViberMessageResult> {
  const config = getApifonConfig();
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
    refId = `appt:${params.customerId}`.slice(0, 255);
  }

  const subscriber: ApifonSubscriber = { number: msisdn };
  if (params.customerId) {
    subscriber.custom_id = params.customerId;
  }

  const requestBody: ApifonImSendRequest = {
    subscribers: [subscriber],
    im_channels: [
      {
        sender_id: config.senderId,
        text: params.text,
        ttl: DEFAULT_VIBER_TTL_SECONDS,
      },
    ],
  };

  if (refId) {
    requestBody.reference_id = refId;
  }

  const callbackUrl = buildApifonStatusCallbackUrl();
  if (callbackUrl) {
    requestBody.callback_url = callbackUrl;
  }

  const endpoint = `${config.baseUrl}${APIFON_IM_SEND_PATH}`;

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
      logViberFailure({ responseStatus: response.status, error: 'apifon_send_failed', responseBody });
      return {
        ok: false,
        skipped: false,
        responseStatus: response.status,
        error: 'apifon_send_failed',
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
    const error = err instanceof Error ? err.message : 'apifon_send_failed';
    logViberFailure({ responseStatus: null, error });
    return {
      ok: false,
      skipped: false,
      responseStatus: null,
      error,
    };
  }
}
