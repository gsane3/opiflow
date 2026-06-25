import { describe, it, expect, vi } from 'vitest';
import { deleteAccount } from '../account.service';
import type { RepoContext } from '../account.repo';

// ---------------------------------------------------------------------------
// Hermetic fake Supabase client: records table .delete() ops (tenantDb chains
// .delete().eq('business_id', …) and the businesses delete chains
// .delete().eq('id', …)), a fake Storage bucket (list/remove), and the auth
// admin deleteUser. Every leaf is thenable so `await`-ing the builder resolves.
// ---------------------------------------------------------------------------

type Res = { data?: unknown; error?: unknown };

interface Opts {
  // storage object paths returned by list(<businessId>) (flat — all are files)
  storageFiles?: string[];
  storageListError?: boolean;
  storageRemoveError?: boolean;
  businessDeleteError?: boolean;
  authDeleteError?: boolean;
}

function fakeCtx(opts: Opts = {}): {
  ctx: RepoContext;
  deletedTables: string[];
  removedChunks: string[][];
  deletedUserId: string | null;
} {
  const deletedTables: string[] = [];
  const removedChunks: string[][] = [];
  let deletedUserId: string | null = null;

  function tableBuilder(table: string) {
    const b = {
      delete: () => b,
      eq: () => b,
      then: (r: (x: Res) => unknown) => {
        if (table === 'businesses') {
          return r(opts.businessDeleteError ? { error: { message: 'boom' } } : { error: null });
        }
        deletedTables.push(table);
        return r({ error: null });
      },
    };
    return b;
  }

  const storage = {
    from(_bucket: string) {
      return {
        list: async (prefix: string) => {
          if (opts.storageListError) return { data: null, error: { message: 'list_fail' } };
          // Only the top-level prefix (businessId) returns files; deeper walks empty.
          const files = prefix && !prefix.includes('/') ? (opts.storageFiles ?? []) : [];
          return {
            data: files.map((name) => ({ name, id: 'file-id' })),
            error: null,
          };
        },
        remove: async (chunk: string[]) => {
          removedChunks.push(chunk);
          return { error: opts.storageRemoveError ? { message: 'remove_fail' } : null };
        },
      };
    },
  };

  const supabase = {
    from: (table: string) => tableBuilder(table),
    storage,
    auth: {
      admin: {
        deleteUser: async (id: string) => {
          if (opts.authDeleteError) return { error: { message: 'auth_fail' } };
          deletedUserId = id;
          return { error: null };
        },
      },
    },
  } as unknown as RepoContext['supabase'];

  return {
    ctx: { userId: 'u1', businessId: 'b1', role: 'owner', supabase },
    deletedTables,
    removedChunks,
    get deletedUserId() {
      return deletedUserId;
    },
  };
}

describe('deleteAccount (cascade parity)', () => {
  it('happy path: purges storage, cascades tables, deletes business + auth user', async () => {
    // names are RELATIVE to the listed prefix (b1) — collectStorageFiles re-joins them.
    const f = fakeCtx({ storageFiles: ['a.jpg', 'b.png'] });
    const result = await deleteAccount(f.ctx);
    expect(result).toEqual({ kind: 'ok', storageRemoved: 2, storagePurgeIncomplete: false });
    // every cascade table was deleted, in order
    expect(f.deletedTables).toEqual([
      'communications',
      'tasks',
      'offers',
      'offer_response_tokens',
      'appointment_response_tokens',
      'customer_intake_tokens',
      'customer_upload_tokens',
      'customer_upload_sessions',
      'customers',
      'phone_number_requests',
      'business_subscriptions',
      'business_users',
    ]);
    expect(f.removedChunks).toEqual([['b1/a.jpg', 'b1/b.png']]);
    expect(f.deletedUserId).toBe('u1');
  });

  it('no storage files → removed 0, not incomplete, still cascades + deletes', async () => {
    const f = fakeCtx({ storageFiles: [] });
    const result = await deleteAccount(f.ctx);
    expect(result).toEqual({ kind: 'ok', storageRemoved: 0, storagePurgeIncomplete: false });
    expect(f.removedChunks).toEqual([]);
    expect(f.deletedUserId).toBe('u1');
  });

  it('storage remove error → storagePurgeIncomplete true + onStoragePurgeIncomplete hook fires, but erasure still succeeds', async () => {
    const f = fakeCtx({ storageFiles: ['x.jpg'], storageRemoveError: true });
    const onIncomplete = vi.fn();
    const result = await deleteAccount(f.ctx, { onStoragePurgeIncomplete: onIncomplete });
    expect(result).toEqual({ kind: 'ok', storageRemoved: 0, storagePurgeIncomplete: true });
    expect(onIncomplete).toHaveBeenCalledWith({ removed: 0 });
    expect(f.deletedUserId).toBe('u1');
  });

  it('business delete failure is FAIL-LOUD → business_failed, auth user NOT touched', async () => {
    const f = fakeCtx({ businessDeleteError: true });
    const result = await deleteAccount(f.ctx);
    expect(result).toEqual({ kind: 'business_failed' });
    expect(f.deletedUserId).toBeNull();
  });

  it('auth user delete failure is FAIL-LOUD → auth_failed (data already deleted)', async () => {
    const f = fakeCtx({ authDeleteError: true });
    const result = await deleteAccount(f.ctx);
    expect(result).toEqual({ kind: 'auth_failed' });
  });
});
