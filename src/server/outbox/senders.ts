// Per-kind senders for the outbox worker.
//
// dispatchOutbox (outbox.ts) drains due events through a `Record<kind, OutboxSender>`
// registry; this builds that registry. A sender reads the event's `payload`, performs
// the side-effect, and THROWS on failure so the worker retries with backoff (and
// dead-letters after maxAttempts). The effectful libs are injected by the cron route,
// so this module stays free of the `@/`-aliased send libs and the unit tests are hermetic.
//
// Supported kinds today: viber / sms / message (the customer's preferred channel),
// push (owner notification), and webhook (generic outbound POST). Add more by recording
// events with a new `kind` and registering a sender here — the engine is kind-agnostic.

import type { OutboxRow, OutboxSender } from './outbox';

export interface OutboxSenderDeps {
  /** Send `text` to a customer via their preferred channel (Viber→SMS or SMS). Returns {ok}. */
  sendMessage: (p: {
    preferred: string | null;
    phone: string | null;
    text: string;
    customerId?: string | null;
    referenceId?: string | null;
  }) => Promise<{ ok: boolean; channel: string }>;
  /** Push to a business owner's devices. */
  sendPush: (businessId: string, payload: { title: string; body: string; url?: string }) => Promise<unknown>;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function buildOutboxSenders(deps: OutboxSenderDeps): Record<string, OutboxSender> {
  // viber / sms / message → the customer's preferred channel (Apifon Viber→SMS, or SMS).
  const messageSender: OutboxSender = async (row: OutboxRow) => {
    const p = asRecord(row.payload);
    const text = str(p.text);
    if (!text) throw new Error("outbox message: missing 'text'");
    const res = await deps.sendMessage({
      preferred: str(p.preferred),
      phone: str(p.phone),
      text,
      customerId: str(p.customerId),
      referenceId: str(p.referenceId),
    });
    if (!res.ok) throw new Error(`outbox message send failed (channel=${res.channel})`);
  };

  // push → owner notification (business id comes off the row; payload carries the content).
  const pushSender: OutboxSender = async (row: OutboxRow) => {
    const p = asRecord(row.payload);
    const title = str(p.title);
    const body = str(p.body);
    if (!row.business_id) throw new Error('outbox push: missing business_id');
    if (!title || !body) throw new Error('outbox push: missing title/body');
    await deps.sendPush(row.business_id, { title, body, url: str(p.url) ?? undefined });
  };

  // webhook → generic outbound POST (no lib; uses global fetch). Non-2xx → retry.
  const webhookSender: OutboxSender = async (row: OutboxRow) => {
    const p = asRecord(row.payload);
    const url = str(p.url);
    if (!url) throw new Error("outbox webhook: missing 'url'");
    const method = str(p.method) ?? 'POST';
    const headers = { 'content-type': 'application/json', ...(asRecord(p.headers) as Record<string, string>) };
    const body = typeof p.body === 'string' ? p.body : JSON.stringify(p.body ?? {});
    const res = await fetch(url, { method, headers, body });
    if (!res.ok) throw new Error(`outbox webhook ${url} → HTTP ${res.status}`);
  };

  return {
    viber: messageSender,
    sms: messageSender,
    message: messageSender,
    push: pushSender,
    webhook: webhookSender,
  };
}
