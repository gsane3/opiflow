// Phone — service (post-auth business logic for the five /api/phone routes).
//
// Parity-matched to the live routes:
//   - twilio-token / browser-token: the gate reads (number assigned + entitled
//     subscription) and the per-user SIP credential resolution. The token MINTING
//     itself (twilio JWT / VoiceGrant) and ALL env handling + response shaping stay
//     in the route — they are security-sensitive and must not move.
//   - telephony / presence / recording: the validation (exact codes + coercions)
//     and the DB read/write, returning a small result the route maps to its exact
//     NextResponse (every degraded:true / status:200 quirk preserved by the route).
//
// These routes do NOT use the AppError / ok() / fail() model, so this service does
// not either — it returns plain discriminated results and lets each route emit the
// identical body it always did.

import { isEntitled } from '../../../lib/billing/entitlement';
import { decryptSecret } from '../../../lib/server/sip-credentials';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  countBusinesses,
  ensureBrowserSipEndpoint,
  getBrowserSipEndpoints,
  getBusinessForBrowserToken,
  getBusinessNumber,
  getPresence,
  getRecording,
  getSubscriptionStatusRow,
  getTelephony,
  updateRecording,
  updateTelephony,
  upsertPresence,
} from './phone.repo';
import type { PerUserCredential, TelephonyRow } from './phone.types';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// ---- twilio-token ----------------------------------------------------------

export type TwilioTokenGate =
  | { ok: true }
  | { ok: false; error: 'no_number_assigned' | 'activation_required'; status: number };

/**
 * twilio-token gate: a Voice token lets the holder place outbound calls (toll-fraud
 * surface), so it is only issued to a business WITH an assigned number AND an
 * activation-allowed subscription. Same gate as browser-token. Codes/statuses are
 * mapped to NextResponse by the route (no_number_assigned=409, activation_required=403).
 */
export async function checkTwilioTokenGate(
  supabase: SupabaseServer,
  businessId: string,
): Promise<TwilioTokenGate> {
  const bizRow = await getBusinessNumber(supabase, businessId);
  if (!bizRow?.business_phone_number) {
    return { ok: false, error: 'no_number_assigned', status: 409 };
  }
  const subRow = await getSubscriptionStatusRow(supabase, businessId);
  const subStatus = subRow?.status ?? null;
  if (!isEntitled(subStatus)) {
    return { ok: false, error: 'activation_required', status: 403 };
  }
  return { ok: true };
}

// ---- browser-token ---------------------------------------------------------

/**
 * Resolves the business's own SIP credential by DECRYPTING the password the PBX
 * provisioner already minted. The provisioner is the SOLE password authority — the
 * app NEVER mints — so the app-issued credential can never diverge from Asterisk's.
 * Returns null (→ shared-env fallback) until a password has been written.
 */
export async function resolvePerUserCredential(
  supabase: SupabaseServer,
  businessId: string,
): Promise<PerUserCredential | null> {
  const { rows, error } = await getBrowserSipEndpoints(supabase, businessId);
  if (error || !rows || rows.length === 0) return null;
  const row = rows[0];
  // Decrypt only — never mint. Fall back to shared env until the provisioner has minted.
  if (!row.sip_username || !row.sip_password_enc) return null;
  const plaintext = decryptSecret(row.sip_password_enc);
  if (!plaintext) return null;
  return { sipUsername: row.sip_username, sipPassword: plaintext };
}

/** browser-token business lookup (raw { data, error } so the route branches exactly). */
export async function loadBrowserTokenBusiness(
  supabase: SupabaseServer,
  businessId: string,
) {
  return getBusinessForBrowserToken(supabase, businessId);
}

/** Entitlement gate for browser-token (mirrors isEntitled on the subscription status). */
export async function isBrowserActivationAllowed(
  supabase: SupabaseServer,
  businessId: string,
): Promise<boolean> {
  const subRow = await getSubscriptionStatusRow(supabase, businessId);
  const subStatus = subRow?.status ?? null;
  return isEntitled(subStatus);
}

/** Best-effort bookkeeping RPC (caller swallows any failure). */
export async function ensureBrowserEndpoint(
  supabase: SupabaseServer,
  businessId: string,
  userId: string,
): Promise<void> {
  await ensureBrowserSipEndpoint(supabase, businessId, userId);
}

/** businesses count for the shared-credential safety gate (>1 ⇒ refuse shared env). */
export async function getBusinessCount(supabase: SupabaseServer): Promise<number> {
  const count = await countBusinesses(supabase);
  return count ?? 0;
}

// ---- telephony -------------------------------------------------------------

const TELEPHONY_VALID = ['native', 'forward'] as const;
type Mode = (typeof TELEPHONY_VALID)[number];

export interface TelephonyView {
  mode: string | null;
  forwardingSourceNumber: string | null;
  businessPhoneNumber: string | null;
}

/** telephony GET. Throws on a DB exception so the route emits its degraded payload. */
export async function readTelephony(
  supabase: SupabaseServer,
  businessId: string,
): Promise<TelephonyView> {
  const data = await getTelephony(supabase, businessId);
  const row: TelephonyRow = data ?? {};
  return {
    mode: row.telephony_mode ?? null,
    forwardingSourceNumber: row.forwarding_source_number ?? null,
    businessPhoneNumber: row.business_phone_number ?? null,
  };
}

export type TelephonyValidation =
  | { ok: true; mode: string; forwardingSourceNumber: string | null }
  | { ok: false; error: 'invalid_mode' };

/** telephony PUT validation: exact mode whitelist + the source-number coercion. */
export function validateTelephony(body: {
  mode?: string;
  forwardingSourceNumber?: string | null;
}): TelephonyValidation {
  const mode = (body.mode ?? '').trim();
  if (!TELEPHONY_VALID.includes(mode as Mode)) {
    return { ok: false, error: 'invalid_mode' };
  }
  const src =
    typeof body.forwardingSourceNumber === 'string'
      ? body.forwardingSourceNumber.replace(/[^\d+]/g, '').slice(0, 24)
      : null;
  const forwardingSourceNumber = mode === 'forward' ? src || null : null;
  return { ok: true, mode, forwardingSourceNumber };
}

/** telephony PUT write. Returns the raw { error } so the route mirrors its branches. */
export async function writeTelephony(
  supabase: SupabaseServer,
  businessId: string,
  mode: string,
  forwardingSourceNumber: string | null,
): Promise<{ error: unknown }> {
  return updateTelephony(supabase, businessId, mode, forwardingSourceNumber);
}

// ---- presence --------------------------------------------------------------

const PRESENCE_VALID = ['available', 'busy', 'away', 'offline', 'dnd'] as const;
type Presence = (typeof PRESENCE_VALID)[number];

/** presence GET. Throws on a DB exception so the route emits its degraded payload. */
export async function readPresence(
  supabase: SupabaseServer,
  userId: string,
  businessId: string,
): Promise<string> {
  const data = await getPresence(supabase, userId, businessId);
  return data?.status ?? 'available';
}

export type PresenceValidation =
  | { ok: true; status: string }
  | { ok: false; error: 'invalid_status' };

/** presence PUT validation: exact status whitelist. */
export function validatePresence(body: { status?: string }): PresenceValidation {
  const status = (body.status ?? '').trim();
  if (!PRESENCE_VALID.includes(status as Presence)) {
    return { ok: false, error: 'invalid_status' };
  }
  return { ok: true, status };
}

/** presence PUT write (upsert). Returns the raw { error } so the route mirrors it. */
export async function writePresence(
  supabase: SupabaseServer,
  userId: string,
  businessId: string,
  status: string,
): Promise<{ error: unknown }> {
  return upsertPresence(supabase, userId, businessId, status);
}

// ---- recording -------------------------------------------------------------

/** Treat a PostgREST "column missing" error as "migration 059 not applied yet". */
export function isMissingColumn(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const m = (err.message ?? '').toLowerCase();
  return err.code === '42703' || err.code === 'PGRST204' || m.includes('record_calls');
}

export type RecordingRead =
  | { degraded: true; recordCalls: true }
  | { degraded: false; recordCalls: boolean };

/**
 * recording GET. A DB error (missing column pre-059 or any read error) → default to
 * recording ON with degraded:true; otherwise recordCalls = record_calls !== false.
 */
export async function readRecording(
  supabase: SupabaseServer,
  businessId: string,
): Promise<RecordingRead> {
  const { data, error } = await getRecording(supabase, businessId);
  if (error) {
    return { degraded: true, recordCalls: true };
  }
  const rc = data?.record_calls;
  return { degraded: false, recordCalls: rc !== false };
}

export type RecordingValidation =
  | { ok: true; recordCalls: boolean }
  | { ok: false; error: 'invalid_record_calls' };

/** recording PUT validation: recordCalls must be a boolean. */
export function validateRecording(body: { recordCalls?: unknown }): RecordingValidation {
  if (typeof body.recordCalls !== 'boolean') {
    return { ok: false, error: 'invalid_record_calls' };
  }
  return { ok: true, recordCalls: body.recordCalls };
}

export type RecordingWrite =
  | { ok: true }
  | { ok: false; migrationPending: boolean };

/**
 * recording PUT write. Classifies a DB error into migration_pending (missing column)
 * vs. a generic update_failed; the route maps both to status:200 degraded bodies.
 */
export async function writeRecording(
  supabase: SupabaseServer,
  businessId: string,
  recordCalls: boolean,
): Promise<RecordingWrite> {
  const { error } = await updateRecording(supabase, businessId, recordCalls);
  if (error) {
    return { ok: false, migrationPending: isMissingColumn(error) };
  }
  return { ok: true };
}
