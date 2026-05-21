import { getPublicAppUrl } from './intake-tokens';

const DEFAULT_APIFON_BASE_URL = 'https://ars.apifon.com';
const APIFON_IM_SEND_PATH = '/services/api/v1/im/send';
const DEFAULT_VIBER_TTL_SECONDS = 86400;

interface ApifonConfig {
  baseUrl: string;
  apiKey: string;
  senderId: string;
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
  const apiKey = process.env.APIFON_API_KEY?.trim();
  const senderId =
    process.env.APIFON_VIBER_SENDER_ID?.trim() ||
    process.env.APIFON_SENDER_ID?.trim();

  if (!apiKey || !senderId) {
    return null;
  }

  return {
    baseUrl: normaliseBaseUrl(process.env.APIFON_BASE_URL),
    apiKey,
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
        text: buildIntakeViberText(params.intakeUrl),
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
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
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
    return {
      ok: false,
      skipped: false,
      responseStatus: null,
      responseBody: null,
      error: err instanceof Error ? err.message : 'apifon_send_failed',
    };
  }
}
