// Customer-message — service (validation + send orchestration + timeline log).
// Parity-matched to POST /api/customers/[id]/message (the post-parse body).
//
// The route stays a thin shell that performs the request-bound concerns it alone
// can do — Bearer auth (authenticateBusinessRequest) and the raw JSON parse — then
// hands the already-parsed body (plus the path :id) to this service, which
// reproduces the route's logic from line `const raw = body as …` onward EXACTLY:
//   - empty_text / too_long validation (codes + order + trim/length coercions),
//   - the channelOverride / workFolderId coercions,
//   - the business-scoped customer load → customer_not_found (404) / no_phone (400),
//   - the phone preference (mobile → phone → landline),
//   - the optional work-folder ownership check (tag only when it belongs),
//   - the EXACT referenceId construction
//     (`msg:${businessId.slice(0,8)}:${customerId.slice(0,8)}:${Date.now().toString(36)}`),
//   - the send via the preferred channel, with send_failed (502, +reason) on
//     `!result.ok || result.channel === 'none'`,
//   - the provider-id extraction + best-effort timeline log,
//   - the success body `{ ok, channel, fallbackApplied }`.
//
// External effects — sendViaPreferredChannel, extractProviderIds and
// recordOutboundMessage — are kept behind injected deps so the route uses the real
// implementations while unit tests stay pure (the covered branches either fire
// BEFORE the send, or inject a stub send/logger). The DB reads live in the repo.
//
// The service returns `{ payload, status }`; the route serialises it verbatim with
// `NextResponse.json(payload, { status })`, so the wire contract (status + JSON
// key order) is byte-for-byte unchanged.

import { loadCustomerContact, workFolderBelongs, type RepoContext } from './customer-message.repo';

export type { RepoContext } from './customer-message.repo';

const MAX_TEXT = 1000;

/** What the thin route serialises: `NextResponse.json(payload, { status })`. */
export interface SendCustomerMessageResponse {
  payload: Record<string, unknown>;
  status: number;
}

/** Shape of a sendViaPreferredChannel result (mirrors src/lib/server/send-channel). */
export interface SendChannelResult {
  ok: boolean;
  channel: 'viber' | 'sms' | 'none';
  viber?: unknown;
  sms?: unknown;
  fallbackApplied: boolean;
  reason?: string;
}

/** Effects injected by the route; unit tests inject stubs. */
export interface SendCustomerMessageDeps {
  sendViaPreferredChannel: (params: {
    preferred: string | null;
    phone: string | null;
    text: string;
    customerId?: string | null;
    referenceId?: string | null;
  }) => Promise<SendChannelResult>;
  extractProviderIds: (detail: unknown) => {
    providerRequestId: string | null;
    providerMessageId: string | null;
  };
  recordOutboundMessage: (params: {
    businessId: string;
    customerId: string | null;
    channel: 'viber' | 'sms' | 'email';
    summary: string;
    phone?: string | null;
    referenceId?: string | null;
    providerRequestId?: string | null;
    providerMessageId?: string | null;
    workFolderId?: string | null;
  }) => Promise<{ communicationId: string | null }>;
}

export async function sendCustomerMessage(
  ctx: RepoContext,
  customerId: string,
  body: unknown,
  deps: SendCustomerMessageDeps,
): Promise<SendCustomerMessageResponse> {
  const { supabase, businessId } = ctx;

  const raw = body as Record<string, unknown>;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return { payload: { ok: false, error: 'empty_text' }, status: 400 };
  if (text.length > MAX_TEXT) return { payload: { ok: false, error: 'too_long' }, status: 400 };
  const channelOverride = raw.channel === 'sms' || raw.channel === 'viber' ? raw.channel : null;
  const workFolderId = typeof raw.workFolderId === 'string' && raw.workFolderId.trim() ? raw.workFolderId.trim() : null;

  // Load the customer (scoped to this business) for phone + preferred channel.
  const customer = await loadCustomerContact(supabase, businessId, customerId);
  if (!customer) {
    return { payload: { ok: false, error: 'customer_not_found' }, status: 404 };
  }
  const c = customer as {
    phone: string | null; mobile_phone: string | null; landline_phone: string | null; preferred_contact_method: string | null;
  };
  const phone = c.mobile_phone || c.phone || c.landline_phone;
  if (!phone) {
    return { payload: { ok: false, error: 'no_phone' }, status: 400 };
  }

  // If filing into a project, verify the folder belongs to this business + customer
  // before tagging (so the message shows in the right project's portal chat).
  let folderTag: string | null = null;
  if (workFolderId) {
    if (await workFolderBelongs(supabase, businessId, customerId, workFolderId)) folderTag = workFolderId;
  }

  const referenceId = `msg:${businessId.slice(0, 8)}:${customerId.slice(0, 8)}:${Date.now().toString(36)}`;
  const result = await deps.sendViaPreferredChannel({
    preferred: channelOverride ?? c.preferred_contact_method,
    phone,
    text,
    customerId,
    referenceId,
  });

  if (!result.ok || result.channel === 'none') {
    return {
      payload: { ok: false, error: 'send_failed', reason: result.reason ?? 'unknown' },
      status: 502,
    };
  }

  const detail = result.channel === 'sms' ? result.sms : result.viber;
  const { providerRequestId, providerMessageId } = deps.extractProviderIds(detail);
  await deps.recordOutboundMessage({
    businessId,
    customerId,
    channel: result.channel,
    summary: text,
    phone,
    referenceId,
    providerRequestId,
    providerMessageId,
    workFolderId: folderTag,
  });

  return { payload: { ok: true, channel: result.channel, fallbackApplied: result.fallbackApplied }, status: 200 };
}
