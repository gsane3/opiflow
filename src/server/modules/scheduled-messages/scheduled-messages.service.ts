// Scheduled messages — service. Parity-matched to /api/scheduled-messages/[id] and
// /api/customers/[id]/scheduled-messages. The tenant-scoped reads/writes live in the
// repo; validation here emits the route's exact codes.

import { AppError } from '../../core/errors';
import {
  cancelScheduledMessageRow,
  fetchCustomerForSchedule,
  insertScheduledMessage,
  listScheduledMessageRowsForCustomer,
  type RepoContext,
} from './scheduled-messages.repo';

/** Cancel a pending scheduled message (no-op if already sent/cancelled or not found). */
export async function cancelScheduledMessage(ctx: RepoContext, id: string): Promise<void> {
  await cancelScheduledMessageRow(ctx, id);
}

export interface ScheduledMessageDTO {
  id: string;
  body: string;
  channel: string;
  scheduledFor: string;
  status: string;
}

/** GET — pending scheduled messages for one customer (always ok; pre-044 → []). */
export async function listScheduledMessages(ctx: RepoContext, customerId: string): Promise<ScheduledMessageDTO[]> {
  const rows = await listScheduledMessageRowsForCustomer(ctx, customerId);
  return rows.map((m) => ({ id: m.id, body: m.body, channel: m.channel, scheduledFor: m.scheduled_for, status: m.status }));
}

/**
 * POST — schedule a send-later text. Validates empty_text/too_long/invalid_date/past_date,
 * then customer ownership (customer_not_found) + reachability (no_phone). Returns
 * { scheduled:false } when the insert fails (pre-044 → 503 route-side).
 */
export async function scheduleMessage(
  ctx: RepoContext,
  customerId: string,
  raw: Record<string, unknown>,
): Promise<{ scheduled: true; id: string } | { scheduled: false }> {
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  const scheduledFor = typeof raw.scheduledFor === 'string' ? raw.scheduledFor : '';
  const channel = raw.channel === 'sms' || raw.channel === 'viber' ? raw.channel : 'auto';

  if (!text) throw new AppError('empty_text', 400);
  if (text.length > 1000) throw new AppError('too_long', 400);
  const when = new Date(scheduledFor);
  if (isNaN(when.getTime())) throw new AppError('invalid_date', 400);
  if (when.getTime() < Date.now() - 60_000) throw new AppError('past_date', 400);

  const cust = await fetchCustomerForSchedule(ctx, customerId);
  if (!cust) throw new AppError('customer_not_found', 404);
  if (!(cust.mobile_phone || cust.phone || cust.landline_phone)) throw new AppError('no_phone', 400);

  const id = await insertScheduledMessage(ctx, {
    customer_id: customerId,
    channel,
    body: text,
    scheduled_for: when.toISOString(),
    status: 'pending',
  });
  if (!id) return { scheduled: false };
  return { scheduled: true, id };
}
