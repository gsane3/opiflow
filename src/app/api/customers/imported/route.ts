// DELETE /api/customers/imported
//
// ADOPTED to the modular pattern (src/server/modules/customers): thin adapter. The
// two scopes (?scope=imported default vs ?scope=all) and the pre-053 column-missing
// tolerance (returns { deleted: 0, columnMissing: true }) live in the service/repo.
// Responses byte-identical; child rows are still handled by the schema FKs.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { bulkDeleteCustomers } from '@/server/modules/customers/customers.service';

export const runtime = 'nodejs';

export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }

  const scope = request.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'imported';

  try {
    const result = await bulkDeleteCustomers(ctx, scope);
    return ok({ ...result });
  } catch (err) {
    return handleApiError(err);
  }
}
