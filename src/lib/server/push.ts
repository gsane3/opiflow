// Server-only push-notification sender (Firebase Cloud Messaging HTTP v1).
//
// FCM HTTP v1 delivers to BOTH Android (directly) and iOS (relayed to APNs once
// the APNs auth key is registered in the Firebase project), so this one path
// covers the whole native fleet. The legacy FCM "server key" API was shut down
// by Google in 2024, so we authenticate with the project's service account via a
// signed JWT → OAuth2 access-token exchange (no external SDK needed).
//
// INERT BY DESIGN: every entry point first checks isPushEnabled(). If the FCM
// service-account env is not configured, all sends are silent no-ops — so wiring
// this into the request flow is safe to ship before the keys exist.
//
// NEVER import this file from client/browser code.

import crypto from 'node:crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface PushPayload {
  title: string;
  body: string;
  /** App path to open when the notification is tapped, e.g. "/customers/123". */
  url?: string;
  /** Extra string data delivered to the app. */
  data?: Record<string, string>;
}

/** Per-device send outcome (for diagnostics). */
export interface PushSendDetail {
  platform: string;
  ok: boolean;
  error?: string;
}

/** Aggregate result of a multi-device send. */
export interface PushSendResult {
  sent: number;
  failed: number;
  tokenCount: number;
  details: PushSendDetail[];
}

interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function normalizeKey(key: string): string {
  // Vercel/.env stores multi-line PEMs with literal "\n" — restore real newlines.
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

/**
 * Loads the FCM service account from env. Supports either:
 *   - FCM_SERVICE_ACCOUNT_JSON  (the downloaded JSON, raw or base64), OR
 *   - FCM_PROJECT_ID + FCM_CLIENT_EMAIL + FCM_PRIVATE_KEY  (split form).
 * Returns null when not configured → the feature stays inert.
 */
function loadServiceAccount(): ServiceAccount | null {
  const json = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (json && json.trim().length > 0) {
    try {
      const raw = json.trim().startsWith('{')
        ? json
        : Buffer.from(json, 'base64').toString('utf8');
      const o = JSON.parse(raw) as {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };
      if (o.project_id && o.client_email && o.private_key) {
        return {
          projectId: o.project_id,
          clientEmail: o.client_email,
          privateKey: normalizeKey(o.private_key),
        };
      }
    } catch {
      // fall through to the split form
    }
  }

  const projectId = process.env.FCM_PROJECT_ID;
  const clientEmail = process.env.FCM_CLIENT_EMAIL;
  const privateKey = process.env.FCM_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey: normalizeKey(privateKey) };
  }
  return null;
}

/** True when the FCM service account is configured. When false, all sends no-op. */
export function isPushEnabled(): boolean {
  return loadServiceAccount() !== null;
}

// ---------------------------------------------------------------------------
// Google OAuth2 access token (service-account JWT grant)
// ---------------------------------------------------------------------------

let cachedToken: { value: string; exp: number } | null = null;

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) {
    return cachedToken.value;
  }

  const claims = {
    iss: sa.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}`;

  let signature: string;
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsigned);
    signature = signer.sign(sa.privateKey, 'base64url');
  } catch {
    return null; // malformed private key
  }
  const assertion = `${unsigned}.${signature}`;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = { value: json.access_token, exp: now + (json.expires_in ?? 3600) };
    return json.access_token;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

interface TokenRow {
  token: string;
  platform: string;
}

async function fetchTokensForUser(userId: string): Promise<TokenRow[]> {
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('device_push_tokens')
      .select('token, platform')
      .eq('user_id', userId);
    return (data as TokenRow[] | null) ?? [];
  } catch {
    return [];
  }
}

async function pruneToken(token: string): Promise<void> {
  try {
    const supabase = createServerSupabaseClient();
    await supabase.from('device_push_tokens').delete().eq('token', token);
  } catch {
    // best-effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends a push to every registered device of a user. No-op (sent:0) when the
 * feature is not configured or the user has no devices. Never throws.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<PushSendResult> {
  const sa = loadServiceAccount();
  if (!sa) return { sent: 0, failed: 0, tokenCount: 0, details: [] }; // inert

  const tokens = await fetchTokensForUser(userId);
  if (tokens.length === 0) return { sent: 0, failed: 0, tokenCount: 0, details: [] };

  const accessToken = await getAccessToken(sa);
  if (!accessToken) {
    return {
      sent: 0,
      failed: tokens.length,
      tokenCount: tokens.length,
      details: tokens.map((t) => ({ platform: t.platform, ok: false, error: 'no_access_token' })),
    };
  }

  const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.projectId}/messages:send`;
  const data: Record<string, string> = { ...(payload.data ?? {}) };
  if (payload.url) data.url = payload.url;

  const details = await Promise.all(
    tokens.map(async (t): Promise<PushSendDetail> => {
      const message = {
        message: {
          token: t.token,
          notification: { title: payload.title, body: payload.body },
          data,
          android: {
            priority: 'HIGH',
            notification: { sound: 'default', default_sound: true },
          },
          apns: {
            payload: { aps: { sound: 'default' } },
          },
        },
      };
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });
        if (res.ok) return { platform: t.platform, ok: true };

        // Prune tokens FCM reports as permanently gone (uninstalled / rotated).
        let errCode = '';
        try {
          const j = (await res.json()) as {
            error?: { status?: string; details?: Array<{ errorCode?: string }> };
          };
          errCode = j.error?.details?.[0]?.errorCode ?? j.error?.status ?? '';
        } catch {
          // ignore parse failure
        }
        if (res.status === 404 || errCode === 'UNREGISTERED') {
          await pruneToken(t.token);
        }
        return { platform: t.platform, ok: false, error: errCode || `http_${res.status}` };
      } catch {
        return { platform: t.platform, ok: false, error: 'network' };
      }
    })
  );

  const sent = details.filter((d) => d.ok).length;
  return { sent, failed: details.length - sent, tokenCount: tokens.length, details };
}

/**
 * Convenience: notify the OWNER of a business (looks up businesses.owner_id).
 * Best-effort and silent — safe to call from request handlers without awaiting
 * a meaningful result. Never throws.
 */
export async function sendPushToBusinessOwner(
  businessId: string,
  payload: PushPayload
): Promise<void> {
  if (!isPushEnabled()) return;
  try {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from('businesses')
      .select('owner_id')
      .eq('id', businessId)
      .maybeSingle();
    const ownerId = (data as { owner_id?: string } | null)?.owner_id;
    if (!ownerId) return;
    await sendPushToUser(ownerId, payload);
  } catch {
    // best-effort: a push failure must never affect the caller's flow
  }
}
