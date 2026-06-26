// Service catalog — list + create (redesign P4). Backs Settings → Κατάλογος and
// the offer composer's auto-suggest. Table: public.service_catalog_items (040).
//
// ADOPTED to the modular pattern (src/server/modules/catalog): this handler is now a
// thin HTTP adapter — auth + parse + delegate to the service + map errors. Behaviour
// and every response are IDENTICAL to the previous inline implementation (verified by
// the module's parity tests); the business logic + tenant-safe DB access moved to the
// service/repo so it can't drift and is unit-tested.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError, AppError } from '@/server/core/errors';
import { listCatalog, createCatalogItem } from '@/server/modules/catalog/catalog.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    // Parity quirk: a signed-in user with no business yet sees an empty catalog, not a 404.
    if (err instanceof AppError && err.status === 404) return ok({ items: [] });
    return handleApiError(err);
  }

  try {
    const { searchParams } = request.nextUrl;
    const q = (searchParams.get('q') ?? '').trim().replace(/[%,()]/g, '');
    const categoryRaw = (searchParams.get('category') ?? '').trim();
    const includeInactive = searchParams.get('all') === '1';
    const items = await listCatalog(ctx, {
      q: q.length > 0 ? q : undefined,
      category: categoryRaw.length > 0 ? categoryRaw : null,
      includeInactive,
    });
    return ok({ items });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

  try {
    const ctx = await requireBusinessUser(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail('invalid_json', 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail('invalid_json', 400);
    }

    const item = await createCatalogItem(ctx, body as Record<string, unknown>, ctx.userId);
    return ok({ item }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
