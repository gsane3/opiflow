// Communications — service (validation + join assembly + orchestration).
//
// Adoption note: preserves /api/communications behaviour and error codes EXACTLY
// (invalid_channel/_direction/_status, customer_not_found, communication_not_found,
// the lenient string coercion, and the camelCase|snake_case customerId acceptance).

import { AppError } from '../../core/errors';
import {
  VALID_CHANNELS,
  VALID_DIRECTIONS,
  VALID_POST_STATUSES,
  type Communication,
  type CommunicationCustomer,
  type CommunicationCustomerRow,
  type CommunicationRow,
} from './communications.types';
import {
  communicationExists,
  customerExists,
  deleteCommunicationRow,
  fetchCustomersByIds,
  insertCommunicationRow,
  listCommunicationRows,
  updateCommunicationCustomer,
  type RepoContext,
} from './communications.repo';

function isValidEnum<T extends string>(value: unknown, valid: readonly T[]): value is T {
  return typeof value === 'string' && (valid as readonly string[]).includes(value);
}

function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function dbToCommunicationCustomer(c: CommunicationCustomerRow): CommunicationCustomer {
  return {
    id: c.id,
    crmNumber: c.crm_number,
    name: c.name,
    companyName: c.company_name,
    phone: c.phone,
    source: c.source,
    status: c.status,
  };
}

export function dbToCommunication(
  row: CommunicationRow,
  customer: CommunicationCustomerRow | null,
): Communication {
  return {
    id: row.id,
    customerId: row.customer_id,
    channel: row.channel,
    direction: row.direction,
    status: row.status,
    phone: row.phone,
    summary: row.summary,
    createdAt: row.created_at,
    customer: customer ? dbToCommunicationCustomer(customer) : null,
  };
}

export interface ListCommunicationsInput {
  channel?: string | null;
  direction?: string | null;
  customerId?: string | null;
  limit?: string | null;
  offset?: string | null;
}

export async function listCommunications(
  ctx: RepoContext,
  input: ListCommunicationsInput,
): Promise<Communication[]> {
  if (input.channel && !isValidEnum(input.channel, VALID_CHANNELS)) {
    throw new AppError('invalid_channel', 400);
  }
  if (input.direction && !isValidEnum(input.direction, VALID_DIRECTIONS)) {
    throw new AppError('invalid_direction', 400);
  }

  const limitRaw = parseInt(input.limit ?? '20', 10);
  const offsetRaw = parseInt(input.offset ?? '0', 10);
  const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 20 : limitRaw, 1), 100);
  const offset = Math.max(Number.isNaN(offsetRaw) ? 0 : offsetRaw, 0);

  const rows = await listCommunicationRows(ctx, {
    channel: input.channel ?? undefined,
    direction: input.direction ?? undefined,
    customerId: input.customerId ?? undefined,
    limit,
    offset,
  });

  const customerIds = Array.from(
    new Set(
      rows
        .map((r) => r.customer_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  const customersById = await fetchCustomersByIds(ctx, customerIds);

  return rows.map((r) =>
    dbToCommunication(r, r.customer_id ? customersById.get(r.customer_id) ?? null : null),
  );
}

export async function createCommunication(
  ctx: RepoContext,
  body: Record<string, unknown>,
): Promise<Communication> {
  if (body.channel !== 'call') throw new AppError('invalid_channel', 400);
  if (!isValidEnum(body.direction, VALID_DIRECTIONS)) throw new AppError('invalid_direction', 400);
  if (!isValidEnum(body.status, VALID_POST_STATUSES)) throw new AppError('invalid_status', 400);

  // Accept camelCase customerId (preferred) or snake_case customer_id (legacy).
  const resolvedCustomerId = nonEmptyString(body.customerId) ?? nonEmptyString(body.customer_id);

  if (resolvedCustomerId && !(await customerExists(ctx, resolvedCustomerId))) {
    throw new AppError('customer_not_found', 404);
  }

  const row = await insertCommunicationRow(ctx, {
    customer_id: resolvedCustomerId,
    channel: 'call',
    direction: body.direction,
    status: body.status,
    phone: nonEmptyString(body.phone),
    summary: nonEmptyString(body.summary),
  });
  return dbToCommunication(row, null);
}

export async function deleteCommunication(ctx: RepoContext, id: string): Promise<void> {
  if (!(await communicationExists(ctx, id))) throw new AppError('communication_not_found', 404);
  await deleteCommunicationRow(ctx, id);
}

export async function updateCommunication(
  ctx: RepoContext,
  id: string,
  body: Record<string, unknown>,
): Promise<Communication> {
  const rawCustomerId = body.customerId;
  if (rawCustomerId !== undefined && rawCustomerId !== null && typeof rawCustomerId !== 'string') {
    throw new AppError('invalid_body', 400);
  }
  const resolvedCustomerId = nonEmptyString(rawCustomerId);

  if (resolvedCustomerId !== null && !(await customerExists(ctx, resolvedCustomerId))) {
    throw new AppError('customer_not_found', 404);
  }

  const row = await updateCommunicationCustomer(ctx, id, resolvedCustomerId);
  if (!row) throw new AppError('communication_not_found', 404);
  return dbToCommunication(row, null);
}
