// webhooks-other — service (post-auth orchestration for the Stripe + Apifon webhooks).
//
// The signature/secret verification stays in the route handlers (verbatim); this service
// owns only the POST-AUTH business logic. Every status/code/body/key-order returned by the
// helpers below is byte-identical to the originating routes:
//   - applyStripeEvent → mirrors the Stripe route's event-type branching + DB upsert. It
//     returns the same `ok` boolean the route used to decide its 500-vs-200 response.
//   - extractSummary / processApifonStatus → mirror the Apifon route's summary build + the
//     entire (non-fatal, broad-catch) DB block; the route returns the same { ok:true, ... }.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';
import {
  applySubscription,
  applySubscriptionExtras,
  findProviderEventId,
  findViberMessageRow,
  insertProviderEvent,
  markProviderEventProcessed,
  updateCommunicationStatus,
  updateViberMessage,
} from './webhooks-other.repo';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// =============================================================================
// Stripe
// =============================================================================

export type StripeEvent = { id?: string; type?: string; data?: { object?: Record<string, unknown> } };

// Apply a (handled, non-payment_failed) Stripe event to business_subscriptions.
// The route owns the secret/signature check, JSON parse, businessId extraction +
// the !businessId / invoice.payment_failed acknowledgements and the supabase 503,
// so this function receives a non-null businessId and returns the same `ok` boolean
// the route used: false → the route logs + returns the 500 db_write_failed body.
// `planKey` is the app-wide PLAN.key passed down by the route (insert shape unchanged).
export async function applyStripeEvent(
  supabase: SupabaseServer,
  event: StripeEvent,
  businessId: string,
  planKey: string
): Promise<boolean> {
  const obj = event.data?.object ?? {};
  // On a checkout session `subscription` holds the sub id; on a subscription
  // object the id IS `obj.id`. `customer` is the Stripe customer id on both.
  const subscriptionId =
    typeof obj.subscription === 'string' ? obj.subscription : typeof obj.id === 'string' ? obj.id : null;
  const customerId = typeof obj.customer === 'string' ? obj.customer : null;

  const now = new Date().toISOString();
  let ok = true;

  // plan_key is an FK into package_plans; 'base'/'premium' exist only after
  // migration 069. If the tiered upsert fails, retry once with the legacy key
  // so a pre-069 deploy still activates the subscription (status is what gates).
  const apply = async (details: Record<string, unknown>): Promise<boolean> => {
    const first = await applySubscription(supabase, businessId, planKey, details);
    if (first || planKey === 'pro') return first;
    return applySubscription(supabase, businessId, 'pro', details);
  };

  // The reliable Stripe linkage, written on every activate event. stripe_customer_id
  // is what the billing portal uses to resolve the account (far more reliable than the
  // user's email); both columns exist since migration 061. Only set when present so a
  // stray event never nulls a stored id.
  const linkFields = (): Record<string, unknown> => {
    const f: Record<string, unknown> = { billing_provider: 'stripe', billing_ref: subscriptionId };
    if (customerId) f.stripe_customer_id = customerId;
    if (subscriptionId) f.stripe_subscription_id = subscriptionId;
    return f;
  };

  if (event.type === 'checkout.session.completed') {
    ok = await apply({
      status: 'active',
      ...linkFields(),
      updated_at: now,
    });
  } else if (event.type === 'customer.subscription.updated') {
    const s = typeof obj.status === 'string' ? obj.status : '';
    if (s === 'active' || s === 'trialing') {
      ok = await apply({
        status: 'active',
        ...linkFields(),
        updated_at: now,
      });
    } else if (s === 'canceled' || s === 'unpaid' || s === 'incomplete_expired') {
      ok = await apply({
        status: 'cancelled',
        cancelled_at: now,
        updated_at: now,
      });
    }
    // transient states (past_due, incomplete) are left unchanged in this slice
  } else if (event.type === 'customer.subscription.deleted') {
    ok = await apply({
      status: 'cancelled',
      cancelled_at: now,
      updated_at: now,
    });
  }

  // Best-effort: the richer fields from migration 064 (stripe_price_id /
  // current_period_end / cancel_at_period_end). Written in an ISOLATED, tolerant
  // update so a pre-064 schema — or a checkout.session payload that lacks them —
  // never fails the webhook (the core write above already succeeded).
  if (ok) {
    const extras = extractSubscriptionExtras(obj);
    if (extras) await applySubscriptionExtras(supabase, businessId, extras);
  }

  return ok;
}

/** Pull the migration-064 detail fields off a Stripe subscription object (nulls when absent). */
function extractSubscriptionExtras(obj: Record<string, unknown>): Record<string, unknown> | null {
  const extras: Record<string, unknown> = {};
  const items = obj.items as { data?: Array<{ price?: { id?: unknown } }> } | undefined;
  const priceId = items?.data?.[0]?.price?.id;
  if (typeof priceId === 'string') extras.stripe_price_id = priceId;
  if (typeof obj.current_period_end === 'number') {
    extras.current_period_end = new Date(obj.current_period_end * 1000).toISOString();
  }
  if (typeof obj.cancel_at_period_end === 'boolean') {
    extras.cancel_at_period_end = obj.cancel_at_period_end;
  }
  return Object.keys(extras).length > 0 ? extras : null;
}

// =============================================================================
// Apifon
// =============================================================================

function safeStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function safeScalar(value: unknown): string | number | boolean | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return null;
}

function safeField(obj: unknown, ...keys: string[]): unknown {
  let cur: unknown = obj;
  for (const key of keys) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Returns payload.data[0] if data is a non-empty array whose first element is an object.
// Confirmed Apifon shape: { request_id, data: [{ message_id, status: { code, text }, ... }], account_id, type }
function getFirstDataObject(payload: unknown): unknown {
  if (!isRecord(payload)) return undefined;
  const data = payload['data'];
  if (!Array.isArray(data) || data.length === 0) return undefined;
  return isRecord(data[0]) ? data[0] : undefined;
}

export function parseFormBody(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  new URLSearchParams(raw).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export type Summary = Record<string, string | number | boolean | null>;

export function extractSummary(root: unknown): Summary {
  // Use data[0] for message-level fields when the confirmed Apifon envelope shape is present.
  // Fall back to root directly for generic or unrecognised payload shapes.
  const msg = getFirstDataObject(root);
  const src = msg ?? root;

  // Top-level envelope fields (root only).
  const request_id = safeScalar(safeField(root, 'request_id')) ?? null;
  const account_id = safeScalar(safeField(root, 'account_id')) ?? null;
  const type       = safeStr(safeField(root, 'type'))          ?? null;

  // array_count from root.data when it is an array.
  let array_count: number | null = null;
  if (isRecord(root) && Array.isArray(root['data'])) {
    array_count = (root['data'] as unknown[]).length;
  }

  // Message-level fields from data[0] when present, otherwise from root.
  const message_id  = safeScalar(safeField(src, 'message_id'))  ?? safeScalar(safeField(src, 'messageId'))  ?? null;
  const custom_id   = safeScalar(safeField(src, 'custom_id'))   ?? safeScalar(safeField(src, 'customId'))   ?? null;
  const from_sender = safeStr(safeField(src, 'from'))                                                       ?? null;
  const recipient   = safeStr(safeField(src, 'to'))
                      ?? safeStr(safeField(src, 'recipient'))
                      ?? safeStr(safeField(src, 'number'))
                      ?? safeStr(safeField(src, 'msisdn'))                                                   ?? null;

  // status.text (confirmed nested shape) with fallback to status as a direct scalar.
  const status      = safeStr(safeField(src, 'status', 'text'))
                      ?? safeScalar(safeField(src, 'status'))                                                ?? null;

  // status.code (confirmed nested shape) with fallback to status_code as a direct field.
  const status_code = safeScalar(safeField(src, 'status', 'code'))
                      ?? safeScalar(safeField(src, 'status_code'))
                      ?? safeScalar(safeField(src, 'statusCode'))                                            ?? null;

  const price        = safeScalar(safeField(src, 'price'))                                                  ?? null;
  const vat          = safeScalar(safeField(src, 'vat'))                                                    ?? null;
  const timestamp    = safeScalar(safeField(src, 'timestamp'))                                              ?? null;
  const delivered_at = safeStr(safeField(src, 'delivered_at')) ?? safeStr(safeField(src, 'deliveredAt'))   ?? null;
  const seen_at      = safeStr(safeField(src, 'seen_at'))      ?? safeStr(safeField(src, 'seenAt'))        ?? null;
  const read_at      = safeStr(safeField(src, 'read_at'))      ?? safeStr(safeField(src, 'readAt'))        ?? null;

  // Retained for fallback compatibility with other payload shapes.
  const reference   = safeScalar(safeField(src, 'reference'))                                               ?? null;
  const description = safeStr(safeField(src, 'description'))                                                ?? null;
  const event_type  = safeScalar(safeField(src, 'event_type')) ?? safeScalar(safeField(src, 'eventType'))  ?? null;

  const summary: Summary = {
    request_id,
    account_id,
    type,
    message_id,
    custom_id,
    from: from_sender,
    recipient,
    status,
    status_code,
    price,
    vat,
    timestamp,
    delivered_at,
    seen_at,
    read_at,
    reference,
    description,
    event_type,
  };

  if (array_count !== null) {
    summary['array_count'] = array_count;
  }

  return summary;
}

// Persist an Apifon status event to the DB and update the matching viber_messages /
// communications rows. Non-fatal: a thrown DB error is swallowed by the caller's broad
// catch (mirrored here) so the route always returns its 200 to Apifon. Returns whether a
// viber_messages row was matched (drives the response `matched` field).
export async function processApifonStatus(
  supabase: SupabaseServer,
  summary: Summary,
  root: unknown
): Promise<boolean> {
  let matched = false;

  // Build a deterministic event_id: request_id + message_id + status_code.
  // Different status events for the same message have different status_code values,
  // so this key is unique per status transition.
  const reqIdStr = typeof summary.request_id === 'string' ? summary.request_id : '';
  const msgIdStr = summary.message_id !== null && summary.message_id !== undefined
    ? String(summary.message_id) : '';
  const scodeStr = summary.status_code !== null && summary.status_code !== undefined
    ? String(summary.status_code) : '';
  const rawEventId = [reqIdStr, msgIdStr, scodeStr].filter(s => s.length > 0).join(':');
  const apifonEventId = rawEventId.length > 0 ? rawEventId : null;

  // Idempotency: skip insert if this exact event was already stored.
  let providerEventId: string | null = null;
  if (apifonEventId) {
    providerEventId = await findProviderEventId(supabase, apifonEventId);
  }

  if (!providerEventId) {
    const eventTypeStr = typeof summary.type === 'string' ? summary.type : 'viber_status';
    providerEventId = await insertProviderEvent(supabase, {
      event_id: apifonEventId,
      event_type: eventTypeStr,
      payload: root,
    });
  }

  // Find matching viber_messages row using a priority fallback chain:
  // provider_message_id > provider_request_id > reference_id.
  const msgIdForMatch = typeof summary.message_id === 'string' ? summary.message_id : null;
  const reqIdForMatch = typeof summary.request_id === 'string' ? summary.request_id : null;
  // summary.reference echoes the reference_id sent in the Apifon request body.
  const refIdForMatch = typeof summary.reference === 'string' ? summary.reference : null;

  const viberRow = await findViberMessageRow(
    supabase,
    msgIdForMatch,
    reqIdForMatch,
    refIdForMatch
  );

  if (viberRow) {
    const statusText = typeof summary.status === 'string' ? summary.status : null;
    const statusCode = summary.status_code !== null && summary.status_code !== undefined
      ? String(summary.status_code) : null;
    const statusLower = statusText?.toLowerCase() ?? '';
    const isDelivered = ['delivered', 'seen', 'read'].includes(statusLower);
    const isFailed = [
      'failed', 'rejected', 'undelivered', 'error', 'not_delivered',
    ].includes(statusLower);
    const normalizedStatus = isDelivered ? 'delivered'
      : isFailed ? 'failed'
      : (statusText ?? 'unknown');

    const now = new Date().toISOString();
    const viberUpdate: Record<string, unknown> = {
      status: normalizedStatus,
      status_code: statusCode,
      status_text: statusText,
      raw_status_payload: root,
      last_provider_event_id: providerEventId,
      updated_at: now,
    };

    // Set delivered_at only on first delivery event.
    if (isDelivered && !viberRow.delivered_at) {
      viberUpdate.delivered_at = now;
    }
    // Set failed_at only on first failure event.
    if (isFailed && !viberRow.failed_at) {
      viberUpdate.failed_at = now;
    }

    await updateViberMessage(supabase, viberRow.id, viberUpdate);

    // Propagate status onto the linked timeline row (communications) so the
    // customer timeline reflects delivered / seen / failed (#57). Best-effort,
    // and guarded with .in('status', allowedPrior) so a late/out-of-order event
    // never regresses a higher status (e.g. seen -> delivered).
    if (viberRow.communication_id) {
      let commStatus: 'delivered' | 'seen' | 'failed' | null = null;
      let allowedPrior: string[] = [];
      if (statusLower === 'seen' || statusLower === 'read') {
        commStatus = 'seen';
        allowedPrior = ['started', 'sent', 'delivered'];
      } else if (isDelivered) {
        commStatus = 'delivered';
        allowedPrior = ['started', 'sent'];
      } else if (isFailed) {
        commStatus = 'failed';
        allowedPrior = ['started', 'sent', 'delivered'];
      }
      if (commStatus) {
        try {
          await updateCommunicationStatus(
            supabase,
            viberRow.communication_id,
            commStatus,
            allowedPrior,
            viberRow.business_id
          );
        } catch {
          // best-effort: status propagation must not affect the 200 to Apifon
        }
      }
    }

    // Mark provider event processed once viber_messages is updated.
    if (providerEventId) {
      await markProviderEventProcessed(supabase, providerEventId, now);
    }

    matched = true;
  }

  return matched;
}
