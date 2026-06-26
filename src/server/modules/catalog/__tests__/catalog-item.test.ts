import { describe, it, expect } from 'vitest';
import { updateCatalogItem, softDeleteCatalogItem } from '../catalog.service';
import type { CatalogRow } from '../catalog.types';
import type { RepoContext } from '../catalog.repo';

type Res = { data?: unknown; error?: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; update(v?: unknown): FB; eq(a?: unknown, b?: unknown): FB;
  maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), update: rec('update'), eq: rec('eq'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return { userId: 'u1', businessId: 'b1', role: 'owner', supabase: { from } as unknown as RepoContext['supabase'] };
}

const row: CatalogRow = {
  id: 'i1', code: 'A1', name: 'Νέο όνομα', description: null, category: null, unit: null,
  unit_price: 50, vat_rate: 24, active: true, source: 'manual', created_at: '2026-01-01T00:00:00Z',
};

describe('updateCatalogItem (parity)', () => {
  it('no_fields when nothing to update', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(updateCatalogItem(ctx, 'i1', {})).rejects.toMatchObject({ code: 'no_fields', status: 400 });
  });
  it('invalid_name when name is blanked', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(updateCatalogItem(ctx, 'i1', { name: '   ' })).rejects.toMatchObject({ code: 'invalid_name' });
  });
  it('not_found when no row matches the tenant', async () => {
    const ctx = fakeCtx(() => ({ data: null }));
    await expect(updateCatalogItem(ctx, 'i1', { name: 'Νέο' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
  it('maps a duplicate-code conflict to 409', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '23505' } }));
    await expect(updateCatalogItem(ctx, 'i1', { code: 'DUP' })).rejects.toMatchObject({ code: 'duplicate_code', status: 409 });
  });
  it('returns the updated item', async () => {
    const ctx = fakeCtx(() => ({ data: row }));
    const item = await updateCatalogItem(ctx, 'i1', { name: 'Νέο όνομα' });
    expect(item.name).toBe('Νέο όνομα');
  });
});

describe('softDeleteCatalogItem (parity)', () => {
  it('resolves on success', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    await expect(softDeleteCatalogItem(ctx, 'i1')).resolves.toBeUndefined();
  });
  it('throws catalog_delete_failed on error', async () => {
    const ctx = fakeCtx(() => ({ error: { message: 'boom' } }));
    await expect(softDeleteCatalogItem(ctx, 'i1')).rejects.toMatchObject({ code: 'catalog_delete_failed', status: 500 });
  });
});
