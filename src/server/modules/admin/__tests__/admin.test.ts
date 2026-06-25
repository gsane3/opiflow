import { describe, it, expect, vi } from 'vitest';
import { getAdminIdentity } from '../admin.service';
import type { AdminSupabaseClient } from '../admin.repo';
import { AppError } from '../../../core/errors';

// Minimal NextRequest stand-in: only headers.get('authorization') is read.
function req(authHeader: string | null) {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'authorization' ? authHeader : null,
    },
  } as unknown as Parameters<typeof getAdminIdentity>[0];
}

// Fake client returning a fixed getUser result.
function fakeClient(result: {
  user: { id: string; email?: string | null } | null;
  error?: unknown;
}): AdminSupabaseClient {
  return {
    auth: {
      getUser: async () => ({ data: { user: result.user }, error: result.error ?? null }),
    },
  };
}

const ADMIN = 'admin-uid';
const withAdminEnv = { getAdminUserId: () => ADMIN };

describe('getAdminIdentity (parity validation)', () => {
  it('missing_auth when no authorization header', async () => {
    await expect(getAdminIdentity(req(null), withAdminEnv)).rejects.toMatchObject({
      code: 'missing_auth',
      status: 401,
    });
  });

  it('missing_auth when the header is not Bearer', async () => {
    await expect(getAdminIdentity(req('Basic xyz'), withAdminEnv)).rejects.toMatchObject({
      code: 'missing_auth',
      status: 401,
    });
  });

  it('admin_not_configured when ADMIN_USER_ID is unset', async () => {
    await expect(
      getAdminIdentity(req('Bearer tok'), { getAdminUserId: () => undefined }),
    ).rejects.toMatchObject({ code: 'admin_not_configured', status: 503 });
  });

  it('propagates missing_supabase_config from the client factory', async () => {
    await expect(
      getAdminIdentity(req('Bearer tok'), {
        getAdminUserId: () => ADMIN,
        createClient: () => {
          throw new AppError('missing_supabase_config', 503);
        },
      }),
    ).rejects.toMatchObject({ code: 'missing_supabase_config', status: 503 });
  });

  it('propagates admin_check_failed from the client factory', async () => {
    await expect(
      getAdminIdentity(req('Bearer tok'), {
        getAdminUserId: () => ADMIN,
        createClient: () => {
          throw new AppError('admin_check_failed', 500);
        },
      }),
    ).rejects.toMatchObject({ code: 'admin_check_failed', status: 500 });
  });

  it('invalid_auth when getUser errors', async () => {
    await expect(
      getAdminIdentity(req('Bearer tok'), {
        getAdminUserId: () => ADMIN,
        createClient: () => fakeClient({ user: null, error: { message: 'bad' } }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_auth', status: 401 });
  });

  it('invalid_auth when there is no user', async () => {
    await expect(
      getAdminIdentity(req('Bearer tok'), {
        getAdminUserId: () => ADMIN,
        createClient: () => fakeClient({ user: null }),
      }),
    ).rejects.toMatchObject({ code: 'invalid_auth', status: 401 });
  });

  it('admin_required when the user is not the configured admin', async () => {
    await expect(
      getAdminIdentity(req('Bearer tok'), {
        getAdminUserId: () => ADMIN,
        createClient: () => fakeClient({ user: { id: 'someone-else', email: 'x@y.z' } }),
      }),
    ).rejects.toMatchObject({ code: 'admin_required', status: 403 });
  });

  it('returns the admin identity on the happy path', async () => {
    const user = await getAdminIdentity(req('Bearer tok'), {
      getAdminUserId: () => ADMIN,
      createClient: () => fakeClient({ user: { id: ADMIN, email: 'admin@opiflow.gr' } }),
    });
    expect(user).toEqual({ id: ADMIN, email: 'admin@opiflow.gr' });
  });

  it('maps a missing email to null', async () => {
    const user = await getAdminIdentity(req('Bearer tok'), {
      getAdminUserId: () => ADMIN,
      createClient: () => fakeClient({ user: { id: ADMIN } }),
    });
    expect(user).toEqual({ id: ADMIN, email: null });
  });

  it('reads the bearer token verbatim (slice(7))', async () => {
    const getUser = vi.fn(async () => ({ data: { user: { id: ADMIN, email: null } }, error: null }));
    await getAdminIdentity(req('Bearer my.jwt.token'), {
      getAdminUserId: () => ADMIN,
      createClient: () => ({ auth: { getUser } }) as unknown as AdminSupabaseClient,
    });
    expect(getUser).toHaveBeenCalledWith('my.jwt.token');
  });
});
