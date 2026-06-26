// Public-folder — service (post-verification DB + business logic). Parity-matched
// to the five public /f/[token] portal routes. The route shells keep the auth
// VERBATIM (rate-limit → content-type → params → JSON parse → body validation →
// findValidFolderToken → createServiceSupabaseClient); from the verified token
// onward, the DB work + effect dispatch live here.
//
// These routes are token-authenticated, not business-user-authenticated, so the
// service uses the SERVICE-ROLE client with explicit business_id + work_folder_id
// `.eq` filters (the token's scope) — there is no requireBusinessUser / tenantDb.
//
// The effectful libs (sendPushToBusinessOwner, applyOfferResponse,
// applyAppointmentResponse, createCustomerUploadToken) are INJECTED by the route
// (dependency injection), structurally identical to the live lib signatures — so
// the service does NOT import lib/server/push (nor offer-accept/appointment-respond
// at runtime), whose transitive `@/lib/supabase/server` import isn't resolvable
// under the test runner. The pure shaping helpers (folder-question / public-folder
// mappers / appointment-status) ARE imported directly (no `@/` transitive dep), so
// the question summary, preview, channel resolution and message mapping stay byte-
// identical. Each method returns either the success payload the route serialises
// verbatim (exact JSON key order) or a PublicFolderFailure carrying the EXACT
// error code + HTTP status of the live route.

import {
  buildFolderQuestionSummary,
  resolveFolderChannel,
  buildQuestionPreview,
} from '../../../lib/server/folder-question';
import {
  mapPublicMessages,
  type MessageRowForPublic,
} from '../../../lib/server/public-folder';
import type { OfferForResponse } from '../../../lib/server/offer-accept';
import type { AppointmentForResponse } from '../../../lib/server/appointment-respond';
import { APPOINTMENT_TYPES } from '../../../lib/server/appointment-status';
import type { PublicFolderContext, PublicFolderFailure } from './public-folder.types';
import {
  fetchFolderForMessage,
  insertQuestionCommunication,
  listFolderMessages,
  markFolderRead,
  fetchOfferForResponse,
  fetchTaskForResponse,
  declarePayment,
  fetchFolderForUpload,
} from './public-folder.repo';

interface FolderRow {
  customer_id: string;
  title: string;
}

const OFFER_COLUMNS = 'id, customer_id, offer_number, status, valid_until, notes, total';
const TASK_COLUMNS = 'id, customer_id, title, type, status, due_date, due_time, note';

// ---------------------------------------------------------------------------
// Injected effect signatures (structurally identical to the live libs). Declared
// here so the service stays unit-testable without pulling the effectful libs'
// `@/lib/supabase/server` transitive import under the test runner.
// ---------------------------------------------------------------------------

/** PushPayload (lib/server/push). */
export interface NotifyOwnerPayload {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, string>;
}
/** sendPushToBusinessOwner (lib/server/push) — best-effort, never throws. */
export type NotifyOwner = (businessId: string, payload: NotifyOwnerPayload) => Promise<void>;

/** applyOfferResponse (lib/server/offer-accept). */
export type ApplyOfferResponse = (opts: {
  supabase: PublicFolderContext['supabase'];
  businessId: string;
  offer: OfferForResponse;
  response: 'accepted' | 'rejected';
  comment: string | null;
  sentChannel: string | null | undefined;
  tokenId?: string | null;
  workFolderId?: string | null;
}) => Promise<{
  ok: boolean;
  httpStatus: number;
  error?: string;
  offerNumber?: string;
  status?: string;
  total?: number;
}>;

/** applyAppointmentResponse (lib/server/appointment-respond). */
export type ApplyAppointmentResponse = (opts: {
  supabase: PublicFolderContext['supabase'];
  businessId: string;
  task: AppointmentForResponse;
  response: 'accepted' | 'declined' | 'time_change_requested';
  comment: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
  sentChannel: string | null | undefined;
  tokenId?: string | null;
  workFolderId?: string | null;
}) => Promise<{
  ok: boolean;
  httpStatus: number;
  error?: string;
  title?: string;
  status?: string;
  dueDate?: string | null;
  dueTime?: string | null;
}>;

/** createCustomerUploadToken (lib/server/upload-tokens) — only the field the route uses. */
export type CreateUploadToken = (params: {
  businessId: string;
  customerId: string;
  workFolderId?: string | null;
  sentChannel?: 'viber' | 'sms' | 'email' | 'manual' | null;
}) => Promise<{ uploadUrl: string }>;

// ---------------------------------------------------------------------------
// message — POST (log a customer question + notify owner)
// ---------------------------------------------------------------------------

export interface LogFolderQuestionDeps {
  /** sendPushToBusinessOwner (injected by the route; best-effort). */
  notifyOwner?: NotifyOwner;
}

/**
 * Log the customer's question as an inbound communications row filed under the
 * folder, then best-effort push the owner. `message` is already validated by the
 * route. Returns null on success (route → { ok:true }) or a failure with the
 * route's exact code/status (folder_message_failed 500 / folder_not_found 404).
 */
export async function logFolderQuestion(
  ctx: PublicFolderContext,
  message: string,
  deps: LogFolderQuestionDeps = {},
): Promise<PublicFolderFailure | null> {
  // Resolve the folder, scoped to the token's business → customer_id + title.
  let folder: FolderRow;
  try {
    const { data, error } = await fetchFolderForMessage(ctx);
    if (error) {
      return { ok: false, error: 'folder_message_failed', status: 500 };
    }
    if (!data) {
      return { ok: false, error: 'folder_not_found', status: 404 };
    }
    folder = data as unknown as FolderRow;
  } catch {
    return { ok: false, error: 'folder_message_failed', status: 500 };
  }

  // Log the inbound question on the customer timeline, filed under the folder.
  const summary = buildFolderQuestionSummary(message);
  try {
    const { error } = await insertQuestionCommunication(ctx, {
      business_id: ctx.businessId,
      customer_id: folder.customer_id,
      work_folder_id: ctx.workFolderId,
      channel: resolveFolderChannel(ctx.sentChannel),
      direction: 'inbound',
      status: 'completed',
      phone: null,
      summary,
    });
    if (error) {
      return { ok: false, error: 'folder_message_failed', status: 500 };
    }
  } catch {
    return { ok: false, error: 'folder_message_failed', status: 500 };
  }

  // Notify the business owner's devices (best-effort; inert until FCM configured,
  // never throws). This is the ONLY notification for a folder question.
  await deps.notifyOwner?.(ctx.businessId, {
    title: 'Νέο μήνυμα από πελάτη',
    body: `${folder.title} — ${buildQuestionPreview(message)}`,
    url: `/customers/${folder.customer_id}`,
    data: {
      type: 'folder_question',
      workFolderId: ctx.workFolderId,
      customerId: folder.customer_id,
    },
  });

  return null;
}

// ---------------------------------------------------------------------------
// message — GET (live chat read + best-effort read receipts)
// ---------------------------------------------------------------------------

export type ListFolderMessagesResult =
  | { ok: true; messages: ReturnType<typeof mapPublicMessages> }
  | PublicFolderFailure;

/**
 * Load the safe Q&A thread (call rows excluded by both the query and the mapper),
 * then best-effort mark the owner's outbound messages read + roll last_visited_at
 * (pre-057 schema → swallowed). DB error → folder_messages_failed (500).
 */
export async function listPublicFolderMessages(
  ctx: PublicFolderContext,
): Promise<ListFolderMessagesResult> {
  try {
    const { data, error } = await listFolderMessages(ctx);
    if (error) {
      return { ok: false, error: 'folder_messages_failed', status: 500 };
    }
    const messages = mapPublicMessages(((data ?? []) as unknown[]) as MessageRowForPublic[]);

    // The customer is viewing the conversation → mark the owner's outbound
    // messages for this folder as read, and roll the token's last_visited_at.
    // Best-effort + tolerant: read_at / last_visited_at are migration 057, so a
    // missing column (pre-057) is ignored and read receipts just don't show yet.
    try {
      const ts = new Date().toISOString();
      await markFolderRead(ctx, ts);
    } catch {
      // pre-057 schema → no read receipts yet
    }

    return { ok: true, messages };
  } catch {
    return { ok: false, error: 'folder_messages_failed', status: 500 };
  }
}

// ---------------------------------------------------------------------------
// offer/accept — POST
// ---------------------------------------------------------------------------

export type RespondOfferResult =
  | { ok: true; offerNumber?: string; status?: string; total?: number }
  | PublicFolderFailure;

export interface RespondOfferDeps {
  /** applyOfferResponse (injected by the route). */
  applyOfferResponse: ApplyOfferResponse;
}

/**
 * Apply the customer's accept/reject to an offer fetched TRIPLE-scoped (business +
 * folder; foreign offerId → offer_not_found 404, no oracle), through the SAME
 * shared lib as the offer-response token route (applyOfferResponse, tokenId omitted,
 * work_folder_id stamped). The lib's result.error/httpStatus pass through verbatim.
 */
export async function respondToFolderOffer(
  ctx: PublicFolderContext,
  offerId: string,
  response: 'accepted' | 'rejected',
  comment: string | null,
  deps: RespondOfferDeps,
): Promise<RespondOfferResult> {
  let offer: OfferForResponse;
  try {
    const { data, error } = await fetchOfferForResponse(ctx, offerId, OFFER_COLUMNS);
    if (error) {
      return { ok: false, error: 'offer_response_failed', status: 500 };
    }
    if (!data) {
      return { ok: false, error: 'offer_not_found', status: 404 };
    }
    offer = data as unknown as OfferForResponse;
  } catch {
    return { ok: false, error: 'offer_response_failed', status: 500 };
  }

  // Same shared path as the token route — tokenId omitted (no offer-response
  // token); stamp work_folder_id so the response lands on the folder timeline.
  const result = await deps.applyOfferResponse({
    supabase: ctx.supabase,
    businessId: ctx.businessId,
    offer,
    response,
    comment,
    sentChannel: ctx.sentChannel,
    tokenId: undefined,
    workFolderId: ctx.workFolderId,
  });
  if (!result.ok) {
    return { ok: false, error: result.error as string, status: result.httpStatus };
  }

  return { ok: true, offerNumber: result.offerNumber, status: result.status, total: result.total };
}

// ---------------------------------------------------------------------------
// appointment/respond — POST
// ---------------------------------------------------------------------------

export type RespondAppointmentResult =
  | { ok: true; title?: string; status?: string; dueDate?: string | null; dueTime?: string | null }
  | PublicFolderFailure;

export interface RespondAppointmentDeps {
  /** applyAppointmentResponse (injected by the route). */
  applyAppointmentResponse: ApplyAppointmentResponse;
}

/**
 * Apply the customer's appointment response to a task fetched TRIPLE-scoped
 * (business + folder) AND asserted to be an appointment type (mismatch →
 * appointment_not_found 404), through the SAME shared lib as the appointment-
 * response token route (applyAppointmentResponse, tokenId omitted, work_folder_id
 * stamped). The lib's result.error/httpStatus pass through verbatim.
 */
export async function respondToFolderAppointment(
  ctx: PublicFolderContext,
  taskId: string,
  response: 'accepted' | 'declined' | 'time_change_requested',
  comment: string | null,
  requestedDueDate: string | null,
  requestedDueTime: string | null,
  deps: RespondAppointmentDeps,
): Promise<RespondAppointmentResult> {
  let task: AppointmentForResponse;
  try {
    const { data, error } = await fetchTaskForResponse(ctx, taskId, TASK_COLUMNS);
    if (error) {
      return { ok: false, error: 'appointment_response_failed', status: 500 };
    }
    const row = data as unknown as (AppointmentForResponse & { type: string }) | null;
    if (!row || !(APPOINTMENT_TYPES as readonly string[]).includes(row.type)) {
      return { ok: false, error: 'appointment_not_found', status: 404 };
    }
    task = row;
  } catch {
    return { ok: false, error: 'appointment_response_failed', status: 500 };
  }

  // Same shared path as the token route — tokenId omitted; stamp work_folder_id.
  const result = await deps.applyAppointmentResponse({
    supabase: ctx.supabase,
    businessId: ctx.businessId,
    task,
    response,
    comment,
    requestedDueDate,
    requestedDueTime,
    sentChannel: ctx.sentChannel,
    tokenId: undefined,
    workFolderId: ctx.workFolderId,
  });
  if (!result.ok) {
    return { ok: false, error: result.error as string, status: result.httpStatus };
  }

  return {
    ok: true,
    title: result.title,
    status: result.status,
    dueDate: result.dueDate,
    dueTime: result.dueTime,
  };
}

// ---------------------------------------------------------------------------
// payment — POST (self-report a bank deposit)
// ---------------------------------------------------------------------------

export interface DeclarePaymentDeps {
  /** sendPushToBusinessOwner (injected by the route; best-effort). */
  notifyOwner?: NotifyOwner;
}

/**
 * Atomically mark a payment request 'pending' → 'declared', scoped to the token's
 * folder + business (foreign/guessed/already-settled → 0 rows → payment_not_actionable
 * 409, no oracle), then best-effort notify the owner to confirm. `paymentRequestId`
 * is already validated by the route. Returns null on success (route → { ok:true }).
 */
export async function declareFolderPayment(
  ctx: PublicFolderContext,
  paymentRequestId: string,
  deps: DeclarePaymentDeps = {},
): Promise<PublicFolderFailure | null> {
  // Atomic: mark 'pending' → 'declared', scoped to the token's folder + business.
  // A wrong/foreign/already-declared id matches no row → generic 409 (no oracle).
  const now = new Date().toISOString();
  let updated: { id: string; customer_id: string | null }[] | null;
  try {
    const { data, error } = await declarePayment(ctx, paymentRequestId, now);
    if (error) return { ok: false, error: 'payment_declare_failed', status: 500 };
    updated = data as unknown as { id: string; customer_id: string | null }[];
  } catch {
    return { ok: false, error: 'payment_declare_failed', status: 500 };
  }
  if (!updated || updated.length === 0) {
    return { ok: false, error: 'payment_not_actionable', status: 409 };
  }

  // Notify the owner to confirm (best-effort, inert until FCM configured).
  await deps.notifyOwner?.(ctx.businessId, {
    title: 'Ο πελάτης δήλωσε κατάθεση',
    body: 'Ένας πελάτης δήλωσε ότι έκανε την κατάθεση — επιβεβαίωσέ τη.',
    ...(updated[0].customer_id ? { url: `/customers/${updated[0].customer_id}` } : {}),
    data: { type: 'payment_declared', paymentRequestId },
  });

  return null;
}

// ---------------------------------------------------------------------------
// upload-link — POST (mint a fresh customer upload token for this folder)
// ---------------------------------------------------------------------------

export type UploadLinkResult =
  | { ok: true; url: string }
  | PublicFolderFailure;

export interface UploadLinkDeps {
  /** createCustomerUploadToken (injected by the route). */
  createUploadToken: CreateUploadToken;
}

interface UploadFolderRow {
  customer_id: string;
}

/**
 * Resolve the folder's customer_id (business + folder scoped; missing → folder_not_found
 * 404), then mint a fresh customer upload token for this folder (sent_channel 'manual')
 * and return the upload URL. Any failure → upload_link_failed (500).
 */
export async function createFolderUploadLink(
  ctx: PublicFolderContext,
  deps: UploadLinkDeps,
): Promise<UploadLinkResult> {
  // Resolve the folder's customer_id, scoped to the token's business. The token
  // carries no customer_id; it is derived here so the upload can only ever be
  // filed under this token's folder/customer/business.
  let folder: UploadFolderRow;
  try {
    const { data, error } = await fetchFolderForUpload(ctx);
    if (error) {
      return { ok: false, error: 'upload_link_failed', status: 500 };
    }
    if (!data || !(data as UploadFolderRow).customer_id) {
      return { ok: false, error: 'folder_not_found', status: 404 };
    }
    folder = data as unknown as UploadFolderRow;
  } catch {
    return { ok: false, error: 'upload_link_failed', status: 500 };
  }

  // Mint a fresh upload token for this folder (sent_channel 'manual' = self-served
  // from the portal). Files land filed under the same work folder.
  try {
    const { uploadUrl } = await deps.createUploadToken({
      businessId: ctx.businessId,
      customerId: folder.customer_id,
      workFolderId: ctx.workFolderId,
      sentChannel: 'manual',
    });
    return { ok: true, url: uploadUrl };
  } catch {
    return { ok: false, error: 'upload_link_failed', status: 500 };
  }
}
