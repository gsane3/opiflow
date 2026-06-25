// Appointment response links — service (explicit validation + orchestration).
// Parity-matched to POST /api/appointment-response-links.
//
// This route only MINTS a secure response link; it never sends a message/email/
// Viber/SMS/notification. Validation produces the route's EXACT error codes
// (invalid_task_id / invalid_sent_channel / invalid_expiry_hours / task_not_found /
// invalid_task_type / invalid_task_status) in the route's EXACT order, instead of a
// generic Zod error, so the response contract is unchanged.
//
// Broad-catch parity: the original wraps the whole body (task lookup + token mint) in
// a single catch that returns appointment_response_link_create_failed (500), and also
// has an inner catch around the token mint with that same code. The service mirrors
// this by wrapping its body in try/catch: any non-AppError throw (DB/lib rejection)
// becomes AppError('appointment_response_link_create_failed', 500); AppErrors raised by
// explicit validation (e.g. task_not_found 404, invalid_task_type 400) pass through.

import { AppError } from '../../core/errors';
import { createAppointmentResponseToken } from '../../../lib/server/appointment-response-tokens';
import { getAppointmentTaskForLink, type RepoContext } from './appointment-links.repo';

// ---------------------------------------------------------------------------
// Helpers (verbatim from the route)
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const VALID_SENT_CHANNELS = ['manual', 'email', 'viber', 'sms'] as const;
type SentChannel = typeof VALID_SENT_CHANNELS[number];

const VALID_APPOINTMENT_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;

function isValidSentChannel(val: unknown): val is SentChannel {
  return typeof val === 'string' && (VALID_SENT_CHANNELS as readonly string[]).includes(val);
}

// ---------------------------------------------------------------------------
// Result shape (matches the route's returned `token` object, in key order)
// ---------------------------------------------------------------------------

export interface CreateAppointmentResponseLinkResult {
  responseUrl: string;
  token: {
    id: string;
    status: string;
    sentChannel: string;
    sentTo: string | null;
    expiresAt: string;
    taskId: string;
  };
}

/** The token-minting dependency (injected so the service stays unit-testable). */
export type MintAppointmentResponseToken = typeof createAppointmentResponseToken;

export interface CreateAppointmentResponseLinkDeps {
  mintToken?: MintAppointmentResponseToken;
}

export async function createAppointmentResponseLink(
  ctx: RepoContext,
  raw: Record<string, unknown>,
  deps: CreateAppointmentResponseLinkDeps = {},
): Promise<CreateAppointmentResponseLinkResult> {
  try {
    // ---- validation (exact codes, exact order) ----

    // Required: taskId
    const taskId = str(raw.taskId);
    if (!taskId) {
      throw new AppError('invalid_task_id', 400);
    }

    // Optional: sentChannel (default 'manual')
    let sentChannel: SentChannel = 'manual';
    if (raw.sentChannel != null) {
      if (!isValidSentChannel(raw.sentChannel)) {
        throw new AppError('invalid_sent_channel', 400);
      }
      sentChannel = raw.sentChannel;
    }

    // Optional: sentTo
    const sentTo = raw.sentTo != null ? str(raw.sentTo) : null;

    // Optional: expiryHours (integer, 1-168)
    let expiryHours: number | undefined;
    if (raw.expiryHours != null) {
      const parsed = typeof raw.expiryHours === 'number' ? raw.expiryHours : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
        throw new AppError('invalid_expiry_hours', 400);
      }
      expiryHours = parsed;
    }

    // ---- validate appointment task: ownership + type + status ----
    const task = await getAppointmentTaskForLink(ctx, taskId);

    if (!task) {
      throw new AppError('task_not_found', 404);
    }

    if (!(VALID_APPOINTMENT_TASK_TYPES as readonly string[]).includes(task.type)) {
      throw new AppError('invalid_task_type', 400);
    }

    if (task.status !== 'open') {
      throw new AppError('invalid_task_status', 400);
    }

    // ---- create response token and link ----
    const mint = deps.mintToken ?? createAppointmentResponseToken;
    const result = await mint({
      businessId: ctx.businessId,
      taskId,
      sentChannel,
      sentTo,
      expiryHours,
    });

    // Return responseUrl and safe token metadata only.
    // rawToken and tokenHash are never returned to the client.
    return {
      responseUrl: result.responseUrl,
      token: {
        id: result.row.id,
        status: result.row.status,
        sentChannel: result.row.sent_channel,
        sentTo: result.row.sent_to,
        expiresAt: result.row.expires_at,
        taskId: result.row.task_id,
      },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('appointment_response_link_create_failed', 500);
  }
}
