import { NextRequest } from 'next/server';
import { ok, handleApiError } from '@/server/core/errors';
import { getAdminIdentity } from '@/server/modules/admin/admin.service';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET /api/admin/me
// ---------------------------------------------------------------------------
// Validates the caller is the configured admin.
// Returns 200 { ok:true, user:{ id, email } } for admin.
// Returns 401, 403, or 503 on failure.
// ADMIN_USER_ID is never included in any response.

export async function GET(request: NextRequest) {
  try {
    const user = await getAdminIdentity(request);
    return ok({
      user: {
        id: user.id,
        email: user.email,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
