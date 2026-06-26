// Customer links — service (explicit validation + orchestration). Parity-matched to
// POST /api/customers/[id]/intake-link, /upload-link and /appointment-link.
//
// Each route MINTS a public token (intake / upload / appointment-response) and, in
// 'send' mode, delivers the link via the customer's preferred channel (Viber→SMS
// fallback or SMS direct) or by email, logging the send to the timeline. The token
// libs, send dispatcher, email sender and timeline logger are EXTERNAL EFFECTS kept
// behind the same thin lib calls the route used — the service never reinvents them.
//
// Validation produces the route's EXACT error codes (invalid_mode / customer_not_found
// / folder_not_found / customer_mismatch / invalid_link / link_expired / missing_task_id
// / appointment_not_found / invalid_task_type / appointment_not_sendable) at the route's
// EXACT positions, instead of a generic Zod error. The successful and non-fatal branches
// return a `{ payload }` the thin route serialises verbatim (key order preserved), so the
// wire contract is unchanged.
//
// Broad-catch parity: the original wraps the WHOLE body in one `catch` returning
// server_error (500). The service mirrors this by wrapping its body in try/catch: any
// non-AppError throw (DB/lib rejection) becomes AppError('server_error', 500); AppErrors
// raised by explicit validation pass through unchanged.

import { AppError } from '../../core/errors';
import { selectViberPhone } from '../../../lib/server/viber-phone';
import {
  createCustomerIntakeToken,
  hashIntakeToken,
  buildIntakeUrl,
  markIntakeTokenSent,
  createServiceSupabaseClient,
} from '../../../lib/server/intake-tokens';
import {
  createCustomerUploadToken,
  hashUploadToken,
  buildUploadUrl,
  markUploadTokenSent,
  revokePendingCustomerUploadTokens,
} from '../../../lib/server/upload-tokens';
import {
  createAppointmentResponseToken,
  hashAppointmentResponseToken,
  buildAppointmentResponseUrl,
  markAppointmentResponseTokenSent,
} from '../../../lib/server/appointment-response-tokens';
import { sendIntakeViberMessage, normalizeApifonMsisdn } from '../../../lib/server/apifon-viber';
import { sendViaPreferredChannel, channelForCustomer } from '../../../lib/server/send-channel';
import { sendCustomerLinkEmail } from '../../../lib/server/customer-email';
import { recordOutboundMessage, extractProviderIds } from '../../../lib/server/record-message';
import { resolveWorkFolderForCreate } from '../../../lib/server/folder-link';
import {
  getBusiness,
  fetchCustomer,
  fetchAppointmentTask,
  findIntakeTokenByHash,
  findUploadTokenByHash,
  findApptTokenByHash,
  revokePendingIntakeTokens,
  markCustomerIntakeSent,
  nudgeCustomerInProgress,
  type RepoContext,
  type TaskRow,
} from './customer-links.repo';

export type { RepoContext } from './customer-links.repo';

/** What a thin route serialises: `NextResponse.json(payload, { status })`. */
export interface LinkResponse {
  payload: Record<string, unknown>;
  status: number;
}

// ---------------------------------------------------------------------------
// Helpers (verbatim from the routes)
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const VALID_MODES = ['draft', 'send'] as const;
type LinkMode = typeof VALID_MODES[number];

function parseMode(raw: Record<string, unknown>): LinkMode {
  if (raw.mode != null) {
    const modeRaw = str(raw.mode);
    if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
      throw new AppError('invalid_mode', 400);
    }
    return modeRaw as LinkMode;
  }
  return 'draft';
}

// Extracts the raw base64url token from a public URL of the form
// {origin}/{prefix}/{rawToken}. Returns null for any invalid input.
function extractRawToken(responseUrl: string): string | null {
  try {
    const url = new URL(responseUrl);
    const parts = url.pathname.split('/');
    const lastPart = parts[parts.length - 1];
    if (!lastPart) return null;
    const rawToken = decodeURIComponent(lastPart);
    if (!/^[A-Za-z0-9_-]+$/.test(rawToken)) return null;
    return rawToken;
  } catch {
    return null;
  }
}

const VALID_APPOINTMENT_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;

function buildIntakeMessage(responseUrl: string, businessName: string | null): string {
  const name = businessName?.trim() || 'την επιχείρηση';
  return [
    'Καλησπέρα σας. Για να καταχωρηθεί σωστά το αίτημά σας, συμπληρώστε τα στοιχεία σας στον παρακάτω σύνδεσμο:',
    responseUrl,
    '',
    'Φιλικά,',
    name,
    'μέσω Opiflow Assistant',
  ].join('\n');
}

function buildUploadMessage(uploadUrl: string, businessName: string | null): string {
  const name = businessName?.trim() || 'την επιχείρηση';
  return [
    'Καλησπέρα σας. Για καλύτερη εξυπηρέτηση, μπορείτε να ανεβάσετε φωτογραφίες ή βίντεο από τη συσκευή και τον χώρο στον παρακάτω σύνδεσμο:',
    uploadUrl,
    '',
    'Φιλικά,',
    name,
    'μέσω Opiflow Assistant',
  ].join('\n');
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

function buildApptMessage(task: TaskRow, responseUrl: string, businessName: string | null): string {
  const name = businessName?.trim() || 'την επιχείρηση';
  const datePart = task.due_date ? formatGreekDate(task.due_date) : null;
  const timePart = str(task.due_time);

  let firstLine: string;
  if (datePart && timePart) {
    firstLine = `Καλησπέρα σας. Το ραντεβού σας είναι για ${datePart} ${timePart}.`;
  } else if (datePart) {
    firstLine = `Καλησπέρα σας. Το ραντεβού σας είναι για ${datePart}.`;
  } else {
    firstLine = 'Καλησπέρα σας. Το ραντεβού σας έχει καταγραφεί.';
  }

  return [
    firstLine,
    'Παρακαλούμε επιβεβαιώστε στον παρακάτω σύνδεσμο:',
    responseUrl,
    '',
    'Φιλικά,',
    name,
    'μέσω Opiflow Assistant',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Intake link
// ---------------------------------------------------------------------------

export async function buildIntakeLink(
  ctx: RepoContext,
  customerId: string,
  raw: Record<string, unknown>,
): Promise<LinkResponse> {
  try {
    const businessId = ctx.businessId;
    const business = await getBusiness(ctx.supabase, businessId);
    const businessName = business?.name ?? null;
    const businessEmail = business?.email ?? null;

    const mode = parseMode(raw);

    // Verify the customer belongs to this business.
    const { customer: customerData, error: customerError } = await fetchCustomer(
      ctx.supabase,
      customerId,
      businessId,
    );
    if (customerError) {
      throw new AppError('server_error', 500);
    }
    if (!customerData) {
      throw new AppError('customer_not_found', 404);
    }
    const customer = customerData;

    // WF-4B: optional folder context. When present, the folder must belong to
    // this business AND this customer; otherwise unchanged (workFolderId = null).
    const folderLink = await resolveWorkFolderForCreate(ctx.supabase, businessId, raw.workFolderId, customerId);
    if (!folderLink.ok) {
      throw new AppError(folderLink.error, folderLink.status);
    }
    const workFolderId = folderLink.workFolderId;

    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    // -- draft mode --------------------------------------------------------
    if (mode === 'draft') {
      const revoke = await revokePendingIntakeTokens(serviceClient, businessId, customerId, now);
      if (revoke.error) {
        throw new AppError('server_error', 500);
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerIntakeToken>>;
      try {
        tokenResult = await createCustomerIntakeToken({
          businessId,
          customerId,
          sentChannel: null,
          workFolderId,
        });
      } catch {
        throw new AppError('server_error', 500);
      }

      const responseUrl = tokenResult.intakeUrl;
      const message = buildIntakeMessage(responseUrl, businessName);
      const recipient = selectViberPhone(customer);

      return {
        payload: {
          mode: 'draft',
          sent: false,
          responseUrl,
          message,
          recipient,
          fallbackReason: null,
        },
        status: 200,
      };
    }

    // -- send mode ---------------------------------------------------------
    const reviewedResponseUrl = str(raw.responseUrl);
    let intakeUrl: string;
    let verifiedTokenId: string | null = null;

    if (reviewedResponseUrl) {
      const rawToken = extractRawToken(reviewedResponseUrl);
      if (!rawToken) {
        throw new AppError('invalid_link', 400);
      }

      const tokenHash = hashIntakeToken(rawToken);
      const { token, error: tokenQueryError } = await findIntakeTokenByHash(
        serviceClient,
        tokenHash,
        customerId,
        businessId,
        now,
      );
      if (tokenQueryError) {
        throw new AppError('server_error', 500);
      }
      if (!token) {
        throw new AppError('link_expired', 422);
      }

      verifiedTokenId = token.id;
      intakeUrl = buildIntakeUrl(rawToken);
    } else {
      const revoke = await revokePendingIntakeTokens(serviceClient, businessId, customerId, now);
      if (revoke.error) {
        throw new AppError('server_error', 500);
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerIntakeToken>>;
      try {
        tokenResult = await createCustomerIntakeToken({
          businessId,
          customerId,
          sentChannel: 'viber',
          workFolderId,
        });
      } catch {
        throw new AppError('server_error', 500);
      }

      intakeUrl = tokenResult.intakeUrl;
    }

    // Email channel (#56).
    if (str(raw.channel) === 'email') {
      const email = str(customer.email);
      if (!email) {
        return { payload: { sent: false, fallbackReason: 'missing_email' }, status: 200 };
      }

      const emailMessage = buildIntakeMessage(intakeUrl, businessName);
      const emailResult = await sendCustomerLinkEmail({
        to: email,
        subject: 'Στοιχεία επικοινωνίας',
        text: emailMessage,
        businessName,
        businessEmail,
      });

      if (!emailResult.ok) {
        const fallbackReason =
          emailResult.reason === 'missing_email_config' ? 'provider_unavailable' : 'provider_failed';
        return { payload: { sent: false, fallbackReason }, status: 200 };
      }

      await recordOutboundMessage({
        businessId,
        customerId,
        channel: 'email',
        summary: 'Αίτημα στοιχείων',
      });

      if (verifiedTokenId) {
        try {
          await markIntakeTokenSent({
            tokenId: verifiedTokenId,
            sentChannel: 'email',
            sentToPhone: null,
          });
        } catch {
          // intentionally swallowed: the email was already sent
        }
      }

      await markCustomerIntakeSent(serviceClient, businessId, customerId, now);
      return { payload: { sent: true, fallbackReason: null }, status: 200 };
    }

    // Look up customer phone for Viber send.
    const rawPhone = selectViberPhone(customer);
    if (!rawPhone) {
      return { payload: { sent: false, fallbackReason: 'missing_mobile' }, status: 200 };
    }

    const msisdn = normalizeApifonMsisdn(rawPhone);
    if (!msisdn) {
      return { payload: { sent: false, fallbackReason: 'missing_mobile' }, status: 200 };
    }

    const referenceId = verifiedTokenId
      ? `intake-notif:${businessId.slice(0, 8)}:${verifiedTokenId.slice(0, 8)}`
      : `intake-notif:${businessId.slice(0, 8)}:${customerId.slice(0, 8)}`;

    const messageText = buildIntakeMessage(intakeUrl, businessName);
    const preferred = customer.preferred_contact_method ?? null;

    let sent = false;
    let fallbackReason: string | null = null;
    let sentChannel: 'viber' | 'sms' | null = null;
    let providerRequestId: string | null = null;
    let providerMessageId: string | null = null;

    if (channelForCustomer(preferred) === 'viber') {
      const viberResult = await sendIntakeViberMessage({
        phone: rawPhone,
        intakeUrl,
        customerId,
        tokenId: verifiedTokenId,
        referenceId,
        messageText,
      });

      if (viberResult.ok) {
        sent = true;
        sentChannel = 'viber';
        providerRequestId = viberResult.requestId;
        providerMessageId = viberResult.messageId;
      } else {
        const smsFallback = await sendViaPreferredChannel({
          preferred: 'sms',
          phone: rawPhone,
          text: messageText,
          customerId,
          referenceId,
        });

        if (smsFallback.ok) {
          sent = true;
          sentChannel = smsFallback.channel === 'sms' ? 'sms' : 'viber';
          const ids = extractProviderIds(smsFallback.sms);
          providerRequestId = ids.providerRequestId;
          providerMessageId = ids.providerMessageId;
        } else if (viberResult.skipped) {
          fallbackReason =
            viberResult.reason === 'missing_apifon_config'
              ? 'provider_unavailable'
              : 'missing_mobile';
        } else {
          fallbackReason = 'provider_failed';
        }
      }
    } else {
      const result = await sendViaPreferredChannel({
        preferred,
        phone: rawPhone,
        text: messageText,
        customerId,
        referenceId,
      });

      sent = result.ok;
      if (result.ok) {
        sentChannel = result.channel === 'sms' ? 'sms' : 'viber';
        const ids = extractProviderIds(result.channel === 'sms' ? result.sms : result.viber);
        providerRequestId = ids.providerRequestId;
        providerMessageId = ids.providerMessageId;
      } else {
        fallbackReason =
          result.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'provider_failed';
      }
    }

    if (!sent) {
      return { payload: { sent: false, fallbackReason }, status: 200 };
    }

    await recordOutboundMessage({
      businessId,
      customerId,
      channel: sentChannel ?? 'viber',
      summary: 'Αίτημα στοιχείων',
      phone: rawPhone,
      referenceId,
      providerRequestId,
      providerMessageId,
    });

    if (verifiedTokenId) {
      try {
        await markIntakeTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: sentChannel ?? 'viber',
          sentToPhone: rawPhone,
        });
      } catch {
        // intentionally swallowed
      }
    }

    await markCustomerIntakeSent(serviceClient, businessId, customerId, now);
    return { payload: { sent: true, fallbackReason: null }, status: 200 };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}

// ---------------------------------------------------------------------------
// Upload link
// ---------------------------------------------------------------------------

export async function buildUploadLink(
  ctx: RepoContext,
  customerId: string,
  raw: Record<string, unknown>,
): Promise<LinkResponse> {
  try {
    const businessId = ctx.businessId;
    const business = await getBusiness(ctx.supabase, businessId);
    const businessName = business?.name ?? null;
    const businessEmail = business?.email ?? null;

    const mode = parseMode(raw);

    const { customer: customerData, error: customerError } = await fetchCustomer(
      ctx.supabase,
      customerId,
      businessId,
    );
    if (customerError) {
      throw new AppError('server_error', 500);
    }
    if (!customerData) {
      throw new AppError('customer_not_found', 404);
    }
    const customer = customerData;

    const folderLink = await resolveWorkFolderForCreate(ctx.supabase, businessId, raw.workFolderId, customerId);
    if (!folderLink.ok) {
      throw new AppError(folderLink.error, folderLink.status);
    }
    const workFolderId = folderLink.workFolderId;

    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    // -- draft mode --------------------------------------------------------
    if (mode === 'draft') {
      try {
        await revokePendingCustomerUploadTokens({ businessId, customerId });
      } catch {
        throw new AppError('server_error', 500);
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerUploadToken>>;
      try {
        tokenResult = await createCustomerUploadToken({
          businessId,
          customerId,
          sentChannel: null,
          workFolderId,
        });
      } catch {
        throw new AppError('server_error', 500);
      }

      const uploadUrl = tokenResult.uploadUrl;
      const message = buildUploadMessage(uploadUrl, businessName);
      const recipient = selectViberPhone(customer);

      return {
        payload: {
          mode: 'draft',
          sent: false,
          responseUrl: uploadUrl,
          message,
          recipient,
          fallbackReason: null,
        },
        status: 200,
      };
    }

    // -- send mode ---------------------------------------------------------
    const reviewedResponseUrl = str(raw.responseUrl);
    let uploadUrl: string;
    let verifiedTokenId: string | null = null;

    if (reviewedResponseUrl) {
      const rawToken = extractRawToken(reviewedResponseUrl);
      if (!rawToken) {
        throw new AppError('invalid_link', 400);
      }

      const tokenHash = hashUploadToken(rawToken);
      const { token, error: tokenQueryError } = await findUploadTokenByHash(
        serviceClient,
        tokenHash,
        customerId,
        businessId,
        now,
      );
      if (tokenQueryError) {
        throw new AppError('server_error', 500);
      }
      if (!token) {
        throw new AppError('link_expired', 422);
      }

      verifiedTokenId = token.id;
      uploadUrl = buildUploadUrl(rawToken);
    } else {
      try {
        await revokePendingCustomerUploadTokens({ businessId, customerId });
      } catch {
        throw new AppError('server_error', 500);
      }

      let tokenResult: Awaited<ReturnType<typeof createCustomerUploadToken>>;
      try {
        tokenResult = await createCustomerUploadToken({
          businessId,
          customerId,
          sentChannel: 'viber',
          workFolderId,
        });
      } catch {
        throw new AppError('server_error', 500);
      }

      uploadUrl = tokenResult.uploadUrl;
    }

    const messageText = buildUploadMessage(uploadUrl, businessName);

    // Email channel (#56).
    if (str(raw.channel) === 'email') {
      const email = str(customer.email);
      if (!email) {
        return { payload: { sent: false, fallbackReason: 'missing_email' }, status: 200 };
      }

      const emailResult = await sendCustomerLinkEmail({
        to: email,
        subject: 'Αποστολή φωτογραφιών',
        text: messageText,
        businessName,
        businessEmail,
      });

      if (!emailResult.ok) {
        const fallbackReason =
          emailResult.reason === 'missing_email_config' ? 'provider_unavailable' : 'provider_failed';
        return { payload: { sent: false, fallbackReason }, status: 200 };
      }

      await recordOutboundMessage({
        businessId,
        customerId,
        channel: 'email',
        summary: 'Αίτημα φωτογραφιών',
      });

      if (verifiedTokenId) {
        try {
          await markUploadTokenSent({
            tokenId: verifiedTokenId,
            sentChannel: 'email',
            sentToPhone: null,
          });
        } catch {
          // intentionally swallowed: the email was already sent
        }
      }

      return { payload: { sent: true, fallbackReason: null }, status: 200 };
    }

    const rawPhone = selectViberPhone(customer);
    if (!rawPhone) {
      return { payload: { sent: false, fallbackReason: 'missing_mobile' }, status: 200 };
    }

    const msisdn = normalizeApifonMsisdn(rawPhone);
    if (!msisdn) {
      return { payload: { sent: false, fallbackReason: 'missing_mobile' }, status: 200 };
    }

    const referenceId = verifiedTokenId
      ? `upload-link:${businessId.slice(0, 8)}:${verifiedTokenId.slice(0, 8)}`
      : `upload-link:${businessId.slice(0, 8)}:${customerId.slice(0, 8)}`;

    const result = await sendViaPreferredChannel({
      preferred: customer.preferred_contact_method ?? null,
      phone: rawPhone,
      text: messageText,
      customerId,
      referenceId,
    });

    if (!result.ok) {
      const fallbackReason =
        result.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'provider_failed';
      return { payload: { sent: false, fallbackReason }, status: 200 };
    }

    {
      const ids = extractProviderIds(result.channel === 'sms' ? result.sms : result.viber);
      await recordOutboundMessage({
        businessId,
        customerId,
        channel: result.channel === 'sms' ? 'sms' : 'viber',
        summary: 'Αίτημα φωτογραφιών',
        phone: rawPhone,
        referenceId,
        providerRequestId: ids.providerRequestId,
        providerMessageId: ids.providerMessageId,
      });
    }

    if (verifiedTokenId) {
      try {
        await markUploadTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: result.channel === 'sms' ? 'sms' : 'viber',
          sentToPhone: rawPhone,
        });
      } catch {
        // intentionally swallowed
      }
    }

    return { payload: { sent: true, fallbackReason: null }, status: 200 };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}

// ---------------------------------------------------------------------------
// Appointment link
// ---------------------------------------------------------------------------

export async function buildAppointmentLink(
  ctx: RepoContext,
  customerId: string,
  raw: Record<string, unknown>,
): Promise<LinkResponse> {
  try {
    const businessId = ctx.businessId;
    const business = await getBusiness(ctx.supabase, businessId);
    const businessName = business?.name ?? null;
    const businessEmail = business?.email ?? null;

    const mode = parseMode(raw);

    // Accept taskId or appointmentId (alias)
    const taskId = str(raw.taskId) ?? str(raw.appointmentId);
    if (!taskId) {
      throw new AppError('missing_task_id', 400);
    }

    const { customer: customerData, error: customerError } = await fetchCustomer(
      ctx.supabase,
      customerId,
      businessId,
    );
    if (customerError) {
      throw new AppError('server_error', 500);
    }
    if (!customerData) {
      throw new AppError('customer_not_found', 404);
    }

    // Verify the task belongs to this customer and business.
    const { task: taskData, error: taskError } = await fetchAppointmentTask(
      ctx.supabase,
      taskId,
      businessId,
      customerId,
    );
    if (taskError) {
      throw new AppError('server_error', 500);
    }
    if (!taskData) {
      throw new AppError('appointment_not_found', 404);
    }

    const task = taskData;

    if (!(VALID_APPOINTMENT_TASK_TYPES as readonly string[]).includes(task.type)) {
      throw new AppError('invalid_task_type', 400);
    }

    if (task.status === 'cancelled' || task.status === 'completed') {
      throw new AppError('appointment_not_sendable', 400);
    }

    const customer = customerData;
    const serviceClient = createServiceSupabaseClient();
    const now = new Date().toISOString();

    const hasMissingTime = !task.due_date || !task.due_time;

    // -- draft mode --------------------------------------------------------
    if (mode === 'draft') {
      let tokenResult: Awaited<ReturnType<typeof createAppointmentResponseToken>>;
      try {
        tokenResult = await createAppointmentResponseToken({
          businessId,
          taskId,
          sentChannel: 'manual',
        });
      } catch {
        throw new AppError('server_error', 500);
      }

      const responseUrl = tokenResult.responseUrl;
      const message = buildApptMessage(task, responseUrl, businessName);
      const recipient = selectViberPhone(customer);

      return {
        payload: {
          mode: 'draft',
          sent: false,
          responseUrl,
          message,
          recipient,
          fallbackReason: null,
          warning: hasMissingTime ? 'missing_appointment_time' : null,
        },
        status: 200,
      };
    }

    // -- send mode ---------------------------------------------------------
    const reviewedResponseUrl = str(raw.responseUrl);
    let responseUrl: string;
    let verifiedTokenId: string | null = null;

    if (reviewedResponseUrl) {
      const rawToken = extractRawToken(reviewedResponseUrl);
      if (!rawToken) {
        throw new AppError('invalid_link', 400);
      }

      const tokenHash = hashAppointmentResponseToken(rawToken);
      const { token, error: tokenQueryError } = await findApptTokenByHash(
        serviceClient,
        tokenHash,
        taskId,
        businessId,
        now,
      );
      if (tokenQueryError) {
        throw new AppError('server_error', 500);
      }
      if (!token) {
        throw new AppError('link_expired', 422);
      }

      verifiedTokenId = token.id;
      responseUrl = buildAppointmentResponseUrl(rawToken);
    } else {
      let tokenResult: Awaited<ReturnType<typeof createAppointmentResponseToken>>;
      try {
        tokenResult = await createAppointmentResponseToken({
          businessId,
          taskId,
          sentChannel: 'viber',
        });
      } catch {
        throw new AppError('server_error', 500);
      }

      responseUrl = tokenResult.responseUrl;
    }

    const messageText = buildApptMessage(task, responseUrl, businessName);

    // Email channel (#56).
    if (str(raw.channel) === 'email') {
      const email = str(customer.email);
      if (!email) {
        return { payload: { sent: false, fallbackReason: 'missing_email' }, status: 200 };
      }

      const emailResult = await sendCustomerLinkEmail({
        to: email,
        subject: 'Επιβεβαίωση ραντεβού',
        text: messageText,
        businessName,
        businessEmail,
      });

      if (!emailResult.ok) {
        const fallbackReason =
          emailResult.reason === 'missing_email_config' ? 'provider_unavailable' : 'provider_failed';
        return { payload: { sent: false, fallbackReason }, status: 200 };
      }

      await recordOutboundMessage({
        businessId,
        customerId,
        channel: 'email',
        summary: 'Επιβεβαίωση ραντεβού',
      });

      if (verifiedTokenId) {
        try {
          await markAppointmentResponseTokenSent({
            tokenId: verifiedTokenId,
            sentChannel: 'email',
            sentTo: email,
          });
        } catch {
          // intentionally swallowed: the email was already sent
        }
      }

      // Mirror the viber/sms path's pipeline nudge (best-effort).
      await nudgeCustomerInProgress(ctx.supabase, businessId, customerId);

      return { payload: { sent: true, fallbackReason: null }, status: 200 };
    }

    const rawPhone = selectViberPhone(customer);
    if (!rawPhone) {
      return { payload: { sent: false, fallbackReason: 'missing_mobile' }, status: 200 };
    }

    const msisdn = normalizeApifonMsisdn(rawPhone);
    if (!msisdn) {
      return { payload: { sent: false, fallbackReason: 'missing_mobile' }, status: 200 };
    }

    const referenceId = verifiedTokenId
      ? `appt-link:${businessId.slice(0, 8)}:${verifiedTokenId.slice(0, 8)}`
      : `appt-link:${businessId.slice(0, 8)}:${taskId.slice(0, 8)}`;

    const result = await sendViaPreferredChannel({
      preferred: customer.preferred_contact_method ?? null,
      phone: rawPhone,
      text: messageText,
      customerId,
      referenceId,
    });

    if (!result.ok) {
      const fallbackReason =
        result.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'provider_failed';
      return { payload: { sent: false, fallbackReason }, status: 200 };
    }

    {
      const ids = extractProviderIds(result.channel === 'sms' ? result.sms : result.viber);
      await recordOutboundMessage({
        businessId,
        customerId,
        channel: result.channel === 'sms' ? 'sms' : 'viber',
        summary: 'Επιβεβαίωση ραντεβού',
        phone: rawPhone,
        referenceId,
        providerRequestId: ids.providerRequestId,
        providerMessageId: ids.providerMessageId,
      });
    }

    if (verifiedTokenId) {
      try {
        await markAppointmentResponseTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: result.channel === 'sms' ? 'sms' : 'viber',
          sentTo: rawPhone,
        });
      } catch {
        // intentionally swallowed
      }
    }

    await nudgeCustomerInProgress(ctx.supabase, businessId, customerId);

    return { payload: { sent: true, fallbackReason: null }, status: 200 };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('server_error', 500);
  }
}
