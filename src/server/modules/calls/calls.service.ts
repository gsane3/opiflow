// Calls (in-app call logger) — service. Parity-matched to /api/calls/log.
//
// Records a browser/native call as a `communications` row (channel='call'). When a
// providerCallId (Twilio CallSid) is given and a dial-time row already exists, it
// FINALISES that row instead of inserting a duplicate, and never overwrites a
// transcript brief the recording webhook may have attached. Customer is matched by
// explicit id (ownership-checked) or by phone — never auto-created here.

import { AppError } from '../../core/errors';
import { deriveActionsFromBriefText } from '../../../lib/server/suggested-actions';
import {
  customerBelongs,
  fetchCallBriefs,
  fetchCallComm,
  fetchCallCustomerName,
  finalizeCall,
  findCallByProviderId,
  insertCall,
  matchCustomerByPhone,
  type RepoContext,
} from './calls.repo';

const DIRECTIONS = ['inbound', 'outbound'] as const;
const STATUSES = ['completed', 'failed', 'missed'] as const;
type Direction = (typeof DIRECTIONS)[number];
type Status = (typeof STATUSES)[number];

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  // Only a plain phone shape passes; anything else (incl. PostgREST punctuation) → null.
  return /^\+?\d{6,15}$/.test(s) ? s : null;
}

function isValidEnum<T extends string>(value: unknown, valid: readonly T[]): value is T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value);
}

function basicSummary(direction: Direction, status: Status): string {
  if (status === 'missed') return 'Αναπάντητη κλήση';
  if (status === 'completed') return direction === 'inbound' ? 'Εισερχόμενη κλήση' : 'Εξερχόμενη κλήση';
  return direction === 'inbound' ? 'Αποτυχημένη εισερχόμενη κλήση' : 'Αποτυχημένη εξερχόμενη κλήση';
}

export interface LogCallResult {
  communicationId: string;
  brief: null;
}

export async function logCall(ctx: RepoContext, raw: Record<string, unknown>): Promise<LogCallResult> {
  const direction = isValidEnum(raw.direction, DIRECTIONS) ? raw.direction : null;
  const status = isValidEnum(raw.status, STATUSES) ? raw.status : null;
  if (!direction || !status) throw new AppError('invalid_call', 400);

  const phone = normalizePhone(str(raw.phone));
  const providerCallId = str(raw.providerCallId);

  let customerId = str(raw.customerId);
  if (customerId && !(await customerBelongs(ctx, customerId))) customerId = null;
  if (!customerId && phone) customerId = await matchCustomerByPhone(ctx, phone);

  const summary = basicSummary(direction, status);

  // Native calls are logged server-side at dial time; finalise that row if present.
  if (providerCallId) {
    const row = await findCallByProviderId(ctx, providerCallId);
    if (row) {
      const hasTranscriptBrief = Boolean(row.brief_created_at);
      await finalizeCall(ctx, row.id, {
        status,
        ...(hasTranscriptBrief ? {} : { summary }),
        ...(customerId && !row.customer_id ? { customer_id: customerId } : {}),
      });
      return { communicationId: row.id, brief: null };
    }
  }

  const id = await insertCall(ctx, {
    customer_id: customerId,
    channel: 'call',
    direction,
    status,
    phone,
    summary,
    ...(providerCallId ? { provider_call_id: providerCallId } : {}),
  });
  return { communicationId: id, brief: null };
}

export interface CallBriefResult {
  id: string;
  ready: boolean;
  briefKind: string | null;
  summary: string | null;
  status: string;
  direction: string;
  phone: string | null;
  customerId: string | null;
  customerName: string | null;
  suggestedActions: Array<{ actionType: string; label: string }>;
}

/**
 * GET /api/calls/[id]/brief. not_found (404) for a missing call; server_error (500) on a
 * hard DB error. Only a TRANSCRIPT brief counts as an AI brief (older speculative metadata
 * briefs are ignored); suggestedActions are derived from the brief TEXT so they work for an
 * unsaved number with no customer.
 */
export async function getCallBrief(ctx: RepoContext, id: string): Promise<CallBriefResult> {
  // The live route wraps the whole body in a single broad catch → server_error, so ANY
  // unexpected throw (incl. a fetch-level DB rejection) becomes server_error — not_found
  // (a return) is the only other observable code. Mirror that here: rethrow AppError
  // (not_found / server_error) as-is, convert anything else to server_error.
  try {
    const comm = await fetchCallComm(ctx, id);
    if (!comm) throw new AppError('not_found', 404);

    let briefKind: string | null = null;
    let briefText: string | null = null;
    for (const b of await fetchCallBriefs(ctx, comm.id)) {
      if (b.brief_kind === 'transcript') {
        briefKind = b.brief_kind;
        briefText = b.brief_text;
      }
    }

    const summary = briefText ?? comm.summary ?? null;
    const ready = briefKind === 'transcript' || Boolean(comm.brief_created_at);

    let customerName: string | null = null;
    if (comm.customer_id) customerName = await fetchCallCustomerName(ctx, comm.customer_id);

    const suggestedActions = deriveActionsFromBriefText(summary).map((a) => ({ actionType: a.actionType, label: a.label }));

    return {
      id: comm.id,
      ready,
      briefKind,
      summary,
      status: comm.status,
      direction: comm.direction,
      phone: comm.phone,
      customerId: comm.customer_id,
      customerName,
      suggestedActions,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}
