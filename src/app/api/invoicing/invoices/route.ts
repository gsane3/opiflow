import type { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { listInvoices } from '@/server/modules/invoicing/invoicing.repo';

export const runtime = 'nodejs';

// GET — list this tenant's issued/failed invoices (newest first).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireBusinessUser(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status') ?? undefined;
    const customerId = url.searchParams.get('customerId') ?? undefined;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100);
    const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);
    const invoices = await listInvoices(ctx, { status, customerId, limit, offset });
    return ok({ invoices, count: invoices.length });
  } catch (err) {
    return handleApiError(err);
  }
}
