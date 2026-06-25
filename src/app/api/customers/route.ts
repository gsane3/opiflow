// CRM customers list and create endpoints.
//
// ADOPTED to the modular pattern (src/server/modules/customers/customers-list.ts): the
// LIST assembly (tolerant needs-intake pinning, pre-044 pin ordering, pin-flag merge,
// pre-053 imported merge) and the CREATE validation/insert live in the module; the route
// is a thin adapter. Business isolation is enforced by tenantDb's structural business_id
// filter. Byte-identical: same query params, codes, status codes and JSON shape.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError, AppError } from '@/server/core/errors';
import { listCustomersForApi, createCustomerForApi } from '@/server/modules/customers/customers-list';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const customers = await listCustomersForApi(ctx, request.nextUrl.searchParams);
    return ok({ customers, count: customers.length });
  } catch (err) {
    if (err instanceof AppError) return fail(err.code, err.status);
    return fail('customers_query_failed', 500);
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return fail('unsupported_content_type', 415);
  }

  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail('invalid_json', 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail('invalid_json', 400);
    }
    const created = await createCustomerForApi(ctx, body as Record<string, unknown>);
    return ok({ customer: created }, 201);
  } catch (err) {
    if (err instanceof AppError) return fail(err.code, err.status);
    return fail('customer_create_failed', 500);
  }
}
