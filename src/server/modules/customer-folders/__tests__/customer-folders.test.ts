import { describe, it, expect } from 'vitest';
import {
  listCustomerFolders,
  createCustomerFolder,
} from '../customer-folders.service';
import type { RepoContext } from '../customer-folders.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };

interface FB {
  select(c?: unknown, o?: unknown): FB;
  insert(v?: unknown): FB;
  eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB;
  order(a?: unknown, b?: unknown): FB;
  single(): FB;
  maybeSingle(): FB;
  then(r: (x: Res) => unknown): unknown;
}

// resolve(table, ops) receives every op recorded on the builder chain (the explicit
// business_id/customer_id .eq filters and the selected columns), so a test can branch
// on the table, the selected columns (FOLDER_COLUMNS has `step`), or the verb used.
function fakeCtx(
  resolve: (table: string, ops: Op[]) => Res,
  throwTables: string[] = [],
): RepoContext {
  function from(table: string): FB {
    if (throwTables.includes(table)) throw new Error(`boom on ${table}`);
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'),
      eq: rec('eq'), in: rec('in'), order: rec('order'),
      single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const cols = (ops: Op[]) => (ops.find((o) => o.m === 'select')?.args[0] ?? '') as string;
const hasVerb = (ops: Op[], m: string) => ops.some((o) => o.m === m);

const folderRow = {
  id: 'f1', business_id: 'b1', customer_id: 'c1', title: 'Έργο', status: 'open',
  step: 1, notes: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// GET list
// ---------------------------------------------------------------------------
describe('listCustomerFolders (parity)', () => {
  it('customer_not_found when the customer is missing/other-tenant', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: [] }));
    await expect(listCustomerFolders(ctx, 'c1')).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });

  it('folders_query_failed when BOTH the primary and base folder selects error', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders') return { error: { message: 'boom' } };
      return { data: [] };
    });
    await expect(listCustomerFolders(ctx, 'c1')).rejects.toMatchObject({ code: 'folders_query_failed', status: 500 });
  });

  it('falls back to the base columns (no `step`) when the primary select errors', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders') {
        // primary select carries `step`; base does not.
        return cols(ops).includes('step') ? { error: { message: 'no step column' } } : { data: [folderRow] };
      }
      return { data: [] };
    });
    const folders = await listCustomerFolders(ctx, 'c1');
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe('f1');
    expect(folders[0].counts).toEqual({ offers: 0, appointments: 0, messages: 0, uploadRequests: 0, intakeRequests: 0 });
  });

  it('returns ordered folders with tallied counts', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders') return { data: [folderRow] };
      if (t === 'offers') return { data: [{ work_folder_id: 'f1' }, { work_folder_id: 'f1' }] };
      if (t === 'tasks') return { data: [{ work_folder_id: 'f1', type: 'visit_customer' }, { work_folder_id: 'f1', type: 'other' }] };
      if (t === 'communications') return { data: [{ work_folder_id: 'f1' }] };
      if (t === 'customer_upload_tokens') return { data: [{ work_folder_id: 'f1' }] };
      if (t === 'customer_intake_tokens') return { data: [] };
      return { data: [] };
    });
    const folders = await listCustomerFolders(ctx, 'c1');
    expect(folders[0].counts).toEqual({ offers: 2, appointments: 1, messages: 1, uploadRequests: 1, intakeRequests: 0 });
  });

  it('counts are best-effort: a thrown count query leaves zeros, list still succeeds', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders') return { data: [folderRow] };
      return { data: [] };
    }, ['offers']);
    const folders = await listCustomerFolders(ctx, 'c1');
    expect(folders).toHaveLength(1);
    expect(folders[0].counts).toEqual({ offers: 0, appointments: 0, messages: 0, uploadRequests: 0, intakeRequests: 0 });
  });

  it('folders_query_failed (broad-catch) when the customer check throws', async () => {
    const ctx = fakeCtx(() => ({ data: [] }), ['customers']);
    await expect(listCustomerFolders(ctx, 'c1')).rejects.toMatchObject({ code: 'folders_query_failed', status: 500 });
  });

  it('empty list (no folders) returns []', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders') return { data: [] };
      return { data: [] };
    });
    await expect(listCustomerFolders(ctx, 'c1')).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST create
// ---------------------------------------------------------------------------
describe('createCustomerFolder (parity validation)', () => {
  const noDb = fakeCtx(() => ({ data: null }));
  it('title_required / title_too_long / invalid_status — validated before the customer check', async () => {
    await expect(createCustomerFolder(noDb, 'c1', { title: '   ' })).rejects.toMatchObject({ code: 'title_required', status: 400 });
    await expect(createCustomerFolder(noDb, 'c1', { title: 'x'.repeat(121) })).rejects.toMatchObject({ code: 'title_too_long', status: 400 });
    await expect(createCustomerFolder(noDb, 'c1', { title: 'Έργο', status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_status', status: 400 });
  });
});

describe('createCustomerFolder (parity behaviour)', () => {
  it('customer_not_found when the customer is missing (after validation passes)', async () => {
    const ctx = fakeCtx((t) => (t === 'customers' ? { data: null } : { data: null }));
    await expect(createCustomerFolder(ctx, 'c1', { title: 'Έργο' })).rejects.toMatchObject({ code: 'customer_not_found', status: 404 });
  });

  it('inserts with BASE columns (no `step`) and returns the folder (default status open)', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders' && hasVerb(ops, 'insert')) {
        expect(cols(ops).includes('step')).toBe(false);
        return { data: { ...folderRow, step: undefined } };
      }
      return { data: null };
    });
    const folder = await createCustomerFolder(ctx, 'c1', { title: 'Έργο' });
    expect(folder.id).toBe('f1');
    expect(folder.step).toBe(0);
  });

  it('accepts an explicit valid status', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders' && hasVerb(ops, 'insert')) return { data: { ...folderRow, status: 'in_progress' } };
      return { data: null };
    });
    const folder = await createCustomerFolder(ctx, 'c1', { title: 'Έργο', status: 'in_progress' });
    expect(folder.status).toBe('in_progress');
  });

  it('folder_create_failed when the insert errors', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders' && hasVerb(ops, 'insert')) return { error: { message: 'boom' } };
      return { data: null };
    });
    await expect(createCustomerFolder(ctx, 'c1', { title: 'Έργο' })).rejects.toMatchObject({ code: 'folder_create_failed', status: 500 });
  });

  it('folder_create_failed when the insert returns no row', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'customers') return { data: { id: 'c1' } };
      if (t === 'work_folders' && hasVerb(ops, 'insert')) return { data: null };
      return { data: null };
    });
    await expect(createCustomerFolder(ctx, 'c1', { title: 'Έργο' })).rejects.toMatchObject({ code: 'folder_create_failed', status: 500 });
  });

  it('folder_create_failed (broad-catch) when the customer check throws', async () => {
    const ctx = fakeCtx(() => ({ data: null }), ['customers']);
    await expect(createCustomerFolder(ctx, 'c1', { title: 'Έργο' })).rejects.toMatchObject({ code: 'folder_create_failed', status: 500 });
  });
});
