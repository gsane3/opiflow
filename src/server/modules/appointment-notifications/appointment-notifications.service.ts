// Appointment notifications — service (explicit validation + message build + send).
// Parity-matched to POST /api/appointment-notifications.
//
// Builds a Viber message for an appointment task and either returns it as a draft
// (mode='draft', default — never calls Apifon) or sends it via Apifon (mode='send',
// only after all validation passes). For kind='proposal' it mints an appointment
// response token so the customer can reply; the response URL is embedded inside the
// message text only and is never returned as a standalone field.
//
// Validation produces the route's EXACT error codes (invalid_body / unsupported_kind /
// invalid_mode / task_not_found / unsupported_task_type / appointment_not_sendable) in
// the route's EXACT order, instead of a generic Zod error, so the contract is unchanged.
//
// Broad-catch parity: the original wraps its whole body in a single catch returning
// appointment_notification_failed (500) — and the task DB error and the token-mint
// failure also return that same code. The service mirrors this by wrapping its body in
// try/catch: any non-AppError throw (DB/lib rejection) becomes AppError('appointment_
// notification_failed', 500); AppErrors raised by explicit validation pass through.
//
// The service returns `{ status, body }` so the thin route can emit the response with
// NextResponse.json and preserve the exact JSON key order.

import { AppError } from '../../core/errors';
import { selectViberPhone } from '../../../lib/server/viber-phone';
import { createAppointmentResponseToken } from '../../../lib/server/appointment-response-tokens';
import { sendViberMessage, normalizeApifonMsisdn } from '../../../lib/server/apifon-viber';
import { getCustomerRow, getTaskRow, type RepoContext, type TaskRow } from './appointment-notifications.repo';

// ---------------------------------------------------------------------------
// Helpers (verbatim from the route)
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatGreekDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('el-GR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const VALID_KINDS = ['proposal', 'time_change_approved', 'time_change_rejected'] as const;
type NotificationKind = typeof VALID_KINDS[number];

const VALID_MODES = ['draft', 'send'] as const;
type NotificationMode = typeof VALID_MODES[number];

const VALID_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;

// ---------------------------------------------------------------------------
// Message builders (verbatim from the route)
// ---------------------------------------------------------------------------

function buildProposalMessage(task: TaskRow, responseUrl: string): string {
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  const lines: string[] = ['Γεια σας.'];

  if (datePart && timePart) {
    lines.push(`Σας προτείνουμε ραντεβού ${datePart} στις ${timePart}.`);
  } else if (datePart) {
    lines.push(`Σας προτείνουμε ραντεβού ${datePart}.`);
  } else {
    lines.push('Σας προτείνουμε ραντεβού.');
  }

  lines.push('Παρακαλούμε επιβεβαιώστε ή προτείνετε άλλη ώρα:');
  lines.push(responseUrl);

  return lines.join(' ');
}

function buildTimeChangeApprovedMessage(task: TaskRow): string {
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  const lines: string[] = ['Γεια σας.'];

  if (datePart && timePart) {
    lines.push(`Η αλλαγή ώρας εγκρίθηκε. Το ραντεβού σας είναι ${datePart} στις ${timePart}.`);
  } else if (datePart) {
    lines.push(`Η αλλαγή ώρας εγκρίθηκε. Το ραντεβού σας είναι ${datePart}.`);
  } else {
    lines.push('Η αλλαγή ώρας εγκρίθηκε.');
  }

  lines.push('Σας ευχαριστούμε.');

  return lines.join(' ');
}

function buildTimeChangeRejectedMessage(task: TaskRow): string {
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  const lines: string[] = ['Γεια σας.'];

  if (datePart && timePart) {
    lines.push(`Δυστυχώς δεν μπορούμε να αλλάξουμε την ώρα. Το ραντεβού παραμένει ${datePart} στις ${timePart}.`);
  } else if (datePart) {
    lines.push(`Δυστυχώς δεν μπορούμε να αλλάξουμε την ώρα. Το ραντεβού παραμένει ${datePart}.`);
  } else {
    lines.push('Δυστυχώς δεν μπορούμε να αλλάξουμε την ώρα.');
  }

  lines.push('Για οποιαδήποτε απορία επικοινωνήστε μαζί μας.');

  return lines.join(' ');
}

// ---------------------------------------------------------------------------
// Result + dependencies
// ---------------------------------------------------------------------------

export interface NotificationResult {
  status: number;
  body: Record<string, unknown>;
}

/** External-effect dependencies (injected so the service stays unit-testable). */
export interface SendAppointmentNotificationDeps {
  mintToken?: typeof createAppointmentResponseToken;
  sendViber?: typeof sendViberMessage;
}

export async function sendAppointmentNotification(
  ctx: RepoContext,
  body: unknown,
  deps: SendAppointmentNotificationDeps = {},
): Promise<NotificationResult> {
  try {
    const businessId = ctx.businessId;

    // Body must be a plain object.
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('invalid_body', 400);
    }
    const raw = body as Record<string, unknown>;

    // Required: taskId
    const taskId = str(raw.taskId);
    if (!taskId) {
      throw new AppError('invalid_body', 400);
    }

    // Required: kind
    const kindRaw = str(raw.kind);
    if (!kindRaw) {
      throw new AppError('invalid_body', 400);
    }
    if (!(VALID_KINDS as readonly string[]).includes(kindRaw)) {
      throw new AppError('unsupported_kind', 400);
    }
    const kind = kindRaw as NotificationKind;

    // Optional: mode (default 'draft')
    let mode: NotificationMode = 'draft';
    if (raw.mode != null) {
      const modeRaw = str(raw.mode);
      if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
        throw new AppError('invalid_mode', 400);
      }
      mode = modeRaw as NotificationMode;
    }

    // Fetch task (business-scoped)
    const { row: taskData, error: taskError } = await getTaskRow(ctx, taskId);

    if (taskError) {
      throw new AppError('appointment_notification_failed', 500);
    }

    if (!taskData) {
      throw new AppError('task_not_found', 404);
    }

    const task = taskData;

    // Validate task type
    if (!(VALID_TASK_TYPES as readonly string[]).includes(task.type)) {
      throw new AppError('unsupported_task_type', 400);
    }

    // Validate task status: only open tasks can be notified
    if (task.status === 'cancelled' || task.status === 'completed') {
      throw new AppError('appointment_not_sendable', 400);
    }

    // ---- Build message text ----
    let messageText: string;
    let tokenId: string | null = null;

    if (kind === 'proposal') {
      // Create appointment response token so the customer can confirm/decline.
      // sentChannel reflects whether we are about to send or just drafting.
      const mint = deps.mintToken ?? createAppointmentResponseToken;
      let responseTokenResult: Awaited<ReturnType<typeof createAppointmentResponseToken>>;
      try {
        responseTokenResult = await mint({
          businessId,
          taskId,
          sentChannel: mode === 'send' ? 'viber' : 'manual',
          sentTo: null,
        });
      } catch {
        throw new AppError('appointment_notification_failed', 500);
      }

      tokenId = responseTokenResult.row.id;
      // The response URL is embedded inside the message text only; it is not
      // returned as a standalone field.
      messageText = buildProposalMessage(task, responseTokenResult.responseUrl);
    } else if (kind === 'time_change_approved') {
      messageText = buildTimeChangeApprovedMessage(task);
    } else {
      messageText = buildTimeChangeRejectedMessage(task);
    }

    // ---- Draft mode: return message text without calling Apifon ----
    if (mode === 'draft') {
      return {
        status: 200,
        body: {
          ok: true,
          sent: false,
          channel: 'viber',
          status: 'draft',
          reason: null,
          fallbackMessage: messageText,
        },
      };
    }

    // ---- Send mode: look up customer and send via Viber ----
    if (!task.customer_id) {
      return {
        status: 200,
        body: {
          ok: true,
          sent: false,
          channel: 'viber',
          status: 'fallback_required',
          reason: 'missing_customer',
          fallbackMessage: messageText,
        },
      };
    }

    const customerData = await getCustomerRow(ctx, task.customer_id);

    if (!customerData) {
      return {
        status: 200,
        body: {
          ok: true,
          sent: false,
          channel: 'viber',
          status: 'fallback_required',
          reason: 'missing_customer',
          fallbackMessage: messageText,
        },
      };
    }

    const customer = customerData;
    const rawPhone = selectViberPhone(customer);

    if (!rawPhone) {
      return {
        status: 200,
        body: {
          ok: true,
          sent: false,
          channel: 'viber',
          status: 'fallback_required',
          reason: 'missing_mobile',
          fallbackMessage: messageText,
        },
      };
    }

    // Validate phone normalizes to a usable MSISDN before calling provider.
    const msisdn = normalizeApifonMsisdn(rawPhone);
    if (!msisdn) {
      return {
        status: 200,
        body: {
          ok: true,
          sent: false,
          channel: 'viber',
          status: 'fallback_required',
          reason: 'missing_mobile',
          fallbackMessage: messageText,
        },
      };
    }

    const referenceId = tokenId
      ? `appt-notif:${businessId.slice(0, 8)}:${tokenId.slice(0, 8)}`
      : `appt-notif:${businessId.slice(0, 8)}:${taskId.slice(0, 8)}`;

    const send = deps.sendViber ?? sendViberMessage;
    const viberResult = await send({
      phone: rawPhone,
      text: messageText,
      customerId: task.customer_id,
      referenceId,
    });

    if (viberResult.skipped) {
      const skipReason =
        viberResult.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'missing_mobile';
      return {
        status: 200,
        body: {
          ok: true,
          sent: false,
          channel: 'viber',
          status: 'fallback_required',
          reason: skipReason,
          fallbackMessage: messageText,
        },
      };
    }

    if (!viberResult.ok) {
      return {
        status: 200,
        body: {
          ok: true,
          sent: false,
          channel: 'viber',
          status: 'fallback_required',
          reason: 'provider_failed',
          fallbackMessage: messageText,
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        sent: true,
        channel: 'viber',
        status: 'sent',
        reason: null,
        fallbackMessage: null,
        requestId: viberResult.requestId,
        messageId: viberResult.messageId,
      },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('appointment_notification_failed', 500);
  }
}
