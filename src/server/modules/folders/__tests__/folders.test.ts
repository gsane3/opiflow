import { describe, it, expect } from 'vitest';
import {
  getFolderDetail,
  patchFolder,
  removeFolder,
  attachEntity,
  listAttachable,
} from '../folders.service';
import type { RepoContext } from '../folders.repo';

type Res = { data?: unknown; error?: unknown; count?: number | null };
type Op = { m: string; args: unknown[] };

interface FB {
  select(c?: unknown, o?: unknown): FB;
  insert(v?: unknown): FB;
  update(v?: unknown): FB;
  delete(): FB;
  eq(a?: unknown, b?: unknown): FB;
  in(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB;
  or(a?: unknown): FB;
  not(a?: unknown, b?: unknown, c?: unknown): FB;
  order(a?: unknown, b?: unknown): FB;
  range(a?: unknown, b?: unknown): FB;
  limit(n?: unknown): FB;
  single(): FB;
  maybeSingle(): FB;
  upsert(v?: unknown): FB;
  then(r: (x: Res) => unknown): unknown;
}

// resolve(table, ops) receives every op recorded on the builder chain (including
// the auto-injected business_id .eq and the selected columns), so a test can branch
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
      select: rec('select'), insert: rec('insert'), update: rec('update'), delete: rec('delete'),
      eq: rec('eq'), in: rec('in'), is: rec('is'), or: rec('or'), not: rec('not'),
      order: rec('order'), range: rec('range'), limit: rec('limit'),
      single: rec('single'), maybeSingle: rec('maybeSingle'), upsert: rec('upsert'),
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
// GET folder detail
// ---------------------------------------------------------------------------
describe('getFolderDetail (parity)', () => {
  it('folder_not_found when the folder is missing/other-tenant', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: null } : { data: [], count: 0 }));
    await expect(getFolderDetail(ctx, 'f1')).rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('folder_detail_failed when BOTH the primary and base folder selects error', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { error: { message: 'boom' } } : { data: [], count: 0 }));
    await expect(getFolderDetail(ctx, 'f1')).rejects.toMatchObject({ code: 'folder_detail_failed', status: 500 });
  });

  it('falls back to the base columns (no `step`) when the primary select errors', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'work_folders') {
        // primary select carries `step`; base does not.
        return cols(ops).includes('step') ? { error: { message: 'no step column' } } : { data: folderRow };
      }
      if (t === 'customers') return { data: null };
      return { data: [], count: 0 };
    });
    const result = await getFolderDetail(ctx, 'f1');
    expect(result.folder.id).toBe('f1');
    expect(result.customer).toBeNull();
    expect(result.sections.offers.count).toBe(0);
  });

  it('aggregates counts, the customer card and section items', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: folderRow };
      if (t === 'customers') return { data: { id: 'c1', name: 'Γιώργος', company_name: null, crm_number: '#1', phone: '+30690', mobile_phone: null, email: 'a@b.gr', address: 'Αθήνα', vat_number: null, intake_status: 'none' } };
      if (t === 'offers') return { data: [{ id: 'o1', offer_number: 'P-1', status: 'sent', total: 100, created_at: 'x' }], count: 1 };
      if (t === 'tasks') return { data: [], count: 2 };
      if (t === 'communications') return { data: [{ id: 'm1', summary: 'γεια', direction: 'inbound', channel: 'sms', created_at: 'x' }], count: 1 };
      if (t === 'customer_upload_tokens') return { data: [], count: 3 };
      if (t === 'customer_intake_tokens') return { data: [], count: 4 };
      return { data: [], count: 0 };
    });
    const result = await getFolderDetail(ctx, 'f1');
    expect(result.customer).toMatchObject({ id: 'c1', name: 'Γιώργος', phone: '+30690', email: 'a@b.gr', hasDetails: true });
    expect(result.sections.offers).toEqual({ count: 1, items: [{ id: 'o1', offerNumber: 'P-1', status: 'sent', total: 100, createdAt: 'x' }] });
    expect(result.sections.appointments.count).toBe(2);
    expect(result.sections.messages.items[0]).toMatchObject({ id: 'm1', readAt: null });
    expect(result.sections.photos.count).toBe(3);
    expect(result.sections.intake.count).toBe(4);
  });

  it('folder_detail_failed (broad-catch) when a section query throws', async () => {
    const ctx = fakeCtx(
      (t) => (t === 'work_folders' ? { data: folderRow } : { data: [], count: 0 }),
      ['offers'],
    );
    await expect(getFolderDetail(ctx, 'f1')).rejects.toMatchObject({ code: 'folder_detail_failed', status: 500 });
  });
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
describe('patchFolder (parity validation)', () => {
  const noDb = fakeCtx(() => ({ data: null }));
  it('title_required / title_too_long / invalid_status / invalid_step', async () => {
    await expect(patchFolder(noDb, 'f1', { title: '   ' })).rejects.toMatchObject({ code: 'title_required', status: 400 });
    await expect(patchFolder(noDb, 'f1', { title: 'x'.repeat(121) })).rejects.toMatchObject({ code: 'title_too_long', status: 400 });
    await expect(patchFolder(noDb, 'f1', { status: 'bogus' })).rejects.toMatchObject({ code: 'invalid_status', status: 400 });
    await expect(patchFolder(noDb, 'f1', { step: 9 })).rejects.toMatchObject({ code: 'invalid_step', status: 400 });
  });
});

describe('patchFolder (parity behaviour)', () => {
  it('returns the current folder unchanged when no allowed field is supplied', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: folderRow } : { data: null }));
    const result = await patchFolder(ctx, 'f1', {});
    expect(result.folder.id).toBe('f1');
  });

  it('folder_not_found when the no-change read matches no row', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: null } : { data: null }));
    await expect(patchFolder(ctx, 'f1', {})).rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('updates a field and returns the folder', async () => {
    const ctx = fakeCtx((t, ops) =>
      t === 'work_folders' && hasVerb(ops, 'update') ? { data: { ...folderRow, title: 'Νέο' } } : { data: folderRow },
    );
    const result = await patchFolder(ctx, 'f1', { title: 'Νέο' });
    expect(result.folder.title).toBe('Νέο');
  });

  it('folder_not_found when the update matches no row', async () => {
    const ctx = fakeCtx((t, ops) => (t === 'work_folders' && hasVerb(ops, 'update') ? { data: null } : { data: folderRow }));
    await expect(patchFolder(ctx, 'f1', { title: 'Νέο' })).rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('folder_update_failed when both update selects error', async () => {
    const ctx = fakeCtx((t, ops) => (t === 'work_folders' && hasVerb(ops, 'update') ? { error: { message: 'boom' } } : { data: folderRow }));
    await expect(patchFolder(ctx, 'f1', { title: 'Νέο' })).rejects.toMatchObject({ code: 'folder_update_failed', status: 500 });
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------
describe('removeFolder (parity)', () => {
  it('folder_not_found when the folder does not exist', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: null } : { count: 0 }));
    await expect(removeFolder(ctx, 'f1')).rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('folder_has_payments when declared/confirmed payments exist', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1' } };
      if (t === 'payment_requests') return { count: 2 };
      return { data: null };
    });
    await expect(removeFolder(ctx, 'f1')).rejects.toMatchObject({ code: 'folder_has_payments', status: 409 });
  });

  it('deletes when it exists and has no landed payments', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1' }, error: null };
      if (t === 'payment_requests') return { count: 0 };
      return { data: null };
    });
    await expect(removeFolder(ctx, 'f1')).resolves.toBeUndefined();
  });

  it('folder_delete_failed when the delete errors', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'work_folders') return hasVerb(ops, 'delete') ? { error: { message: 'boom' } } : { data: { id: 'f1' } };
      if (t === 'payment_requests') return { count: 0 };
      return { data: null };
    });
    await expect(removeFolder(ctx, 'f1')).rejects.toMatchObject({ code: 'folder_delete_failed', status: 500 });
  });
});

// ---------------------------------------------------------------------------
// attach
// ---------------------------------------------------------------------------
describe('attachEntity (parity)', () => {
  const noDb = fakeCtx(() => ({ data: null }));
  it('invalid_entity_type / invalid_entity_id / invalid_attach', async () => {
    await expect(attachEntity(noDb, 'f1', { entityType: 'nope', entityId: 'e1', attach: true })).rejects.toMatchObject({ code: 'invalid_entity_type', status: 400 });
    await expect(attachEntity(noDb, 'f1', { entityType: 'offer', entityId: '  ', attach: true })).rejects.toMatchObject({ code: 'invalid_entity_id', status: 400 });
    await expect(attachEntity(noDb, 'f1', { entityType: 'offer', entityId: 'e1', attach: 'yes' })).rejects.toMatchObject({ code: 'invalid_attach', status: 400 });
  });

  it('folder_not_found when the folder is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: null } : { data: null }));
    await expect(attachEntity(ctx, 'f1', { entityType: 'offer', entityId: 'e1', attach: true })).rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('entity_not_found when the entity is missing', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return { data: null };
      return { data: null };
    });
    await expect(attachEntity(ctx, 'f1', { entityType: 'offer', entityId: 'e1', attach: true })).rejects.toMatchObject({ code: 'entity_not_found', status: 404 });
  });

  it('customer_mismatch when attaching another customer’s entity', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return { data: { id: 'e1', customer_id: 'cOTHER' } };
      return { data: null };
    });
    await expect(attachEntity(ctx, 'f1', { entityType: 'offer', entityId: 'e1', attach: true })).rejects.toMatchObject({ code: 'customer_mismatch', status: 409 });
  });

  it('attaches successfully (same customer)', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'offers') return hasVerb(ops, 'update') ? { error: null } : { data: { id: 'e1', customer_id: 'c1' } };
      return { data: null };
    });
    const result = await attachEntity(ctx, 'f1', { entityType: 'offer', entityId: 'e1', attach: true });
    expect(result).toEqual({ entityType: 'offer', entityId: 'e1', attached: true, workFolderId: 'f1' });
  });

  it('detaches (attach=false) without the customer check', async () => {
    const ctx = fakeCtx((t, ops) => {
      if (t === 'work_folders') return { data: { id: 'f1', customer_id: 'c1' } };
      if (t === 'tasks') return hasVerb(ops, 'update') ? { error: null } : { data: { id: 'e1', customer_id: 'cOTHER' } };
      return { data: null };
    });
    const result = await attachEntity(ctx, 'f1', { entityType: 'task', entityId: 'e1', attach: false });
    expect(result).toEqual({ entityType: 'task', entityId: 'e1', attached: false, workFolderId: null });
  });

  it('attach_failed (broad-catch) when the entity lookup throws', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: { id: 'f1', customer_id: 'c1' } } : { data: null }), ['offers']);
    await expect(attachEntity(ctx, 'f1', { entityType: 'offer', entityId: 'e1', attach: true })).rejects.toMatchObject({ code: 'attach_failed', status: 500 });
  });
});

// ---------------------------------------------------------------------------
// attachable
// ---------------------------------------------------------------------------
describe('listAttachable (parity)', () => {
  it('folder_not_found when the folder is missing', async () => {
    const ctx = fakeCtx((t) => (t === 'work_folders' ? { data: null } : { data: [] }));
    await expect(listAttachable(ctx, 'f1')).rejects.toMatchObject({ code: 'folder_not_found', status: 404 });
  });

  it('attachable_failed when a source query errors', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { customer_id: 'c1' } };
      if (t === 'offers') return { error: { message: 'boom' } };
      return { data: [] };
    });
    await expect(listAttachable(ctx, 'f1')).rejects.toMatchObject({ code: 'attachable_failed', status: 500 });
  });

  it('returns the five unfiled buckets', async () => {
    const ctx = fakeCtx((t) => {
      if (t === 'work_folders') return { data: { customer_id: 'c1' } };
      if (t === 'offers') return { data: [{ id: 'o1', offer_number: 'P-1', status: 'sent', total: 50 }] };
      if (t === 'tasks') return { data: [{ id: 't1', title: 'Ραντεβού', type: 'visit_customer', status: 'open', due_date: '2026-07-01', due_time: null }] };
      if (t === 'communications') return { data: [{ id: 'm1', direction: 'inbound', channel: 'sms', summary: 'γεια', created_at: 'x' }] };
      if (t === 'customer_intake_tokens') return { data: [{ id: 'i1', status: 'sent', sent_channel: 'sms', created_at: 'x' }] };
      if (t === 'customer_upload_tokens') return { data: [{ id: 'u1', status: 'sent', sent_channel: null, created_at: 'x' }] };
      return { data: [] };
    });
    const result = await listAttachable(ctx, 'f1');
    expect(result.offers).toEqual([{ id: 'o1', offerNumber: 'P-1', status: 'sent', total: 50 }]);
    expect(result.appointments[0]).toMatchObject({ id: 't1', type: 'visit_customer' });
    expect(result.messages[0]).toMatchObject({ id: 'm1', channel: 'sms' });
    expect(result.intake[0]).toMatchObject({ id: 'i1', sentChannel: 'sms' });
    expect(result.upload[0]).toMatchObject({ id: 'u1', sentChannel: null });
  });

  it('attachable_failed (broad-catch) when the folder read throws', async () => {
    const ctx = fakeCtx(() => ({ data: [] }), ['work_folders']);
    await expect(listAttachable(ctx, 'f1')).rejects.toMatchObject({ code: 'attachable_failed', status: 500 });
  });
});
