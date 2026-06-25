import { describe, it, expect } from 'vitest';
import { listCatalog, createCatalogItem, dbToItem } from '../catalog.service';
import type { CatalogRow } from '../catalog.types';
import { AppError } from '../../../core/errors';
import type { RepoContext } from '../catalog.repo';

type Res = { data: unknown; error: unknown };
type Op = { m: string; args: unknown[] };
interface FB {
  select(c?: string): FB; insert(v?: unknown): FB; update(v?: unknown): FB; delete(): FB;
  eq(a?: unknown, b?: unknown): FB; lte(a?: unknown, b?: unknown): FB; in(a?: unknown, b?: unknown): FB;
  is(a?: unknown, b?: unknown): FB; or(a?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  limit(n?: number): FB; single(): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeCtx(resolve: (table: string, ops: Op[]) => Res): RepoContext {
  function from(table: string): FB {
    const ops: Op[] = [];
    const rec = (m: string) => (...args: unknown[]): FB => { ops.push({ m, args }); return b; };
    const b: FB = {
      select: rec('select'), insert: rec('insert'), update: rec('update'), delete: rec('delete'),
      eq: rec('eq'), lte: rec('lte'), in: rec('in'), is: rec('is'), or: rec('or'),
      order: rec('order'), limit: rec('limit'), single: rec('single'), maybeSingle: rec('maybeSingle'),
      then: (r) => r(resolve(table, ops)),
    };
    return b;
  }
  return {
    userId: 'u1', businessId: 'b1', role: 'owner',
    supabase: { from } as unknown as RepoContext['supabase'],
  };
}

const sampleRow: CatalogRow = {
  id: 'i1', code: 'A1', name: 'Εγκατάσταση', description: null, category: 'Υδραυλικά',
  unit: 'τεμ', unit_price: 50, vat_rate: 24, active: true, source: 'manual', created_at: '2026-01-01T00:00:00Z',
};

describe('dbToItem', () => {
  it('maps snake_case to camelCase', () => {
    const dto = dbToItem(sampleRow);
    expect(dto.unitPrice).toBe(50);
    expect(dto.vatRate).toBe(24);
    expect(dto.createdAt).toBe('2026-01-01T00:00:00Z');
  });
});

describe('createCatalogItem (parity)', () => {
  it('throws invalid_name (400) when name is missing', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(createCatalogItem(ctx, {}, 'u1')).rejects.toMatchObject({ code: 'invalid_name', status: 400 });
  });

  it('inserts and returns the mapped item, defaulting vat/price/source', async () => {
    const captured: Record<string, unknown>[] = [];
    const ctx = fakeCtx((_t, ops) => {
      const ins = ops.find((o) => o.m === 'insert');
      if (ins) { captured.push(ins.args[0] as Record<string, unknown>); return { data: sampleRow, error: null }; }
      return { data: null, error: null };
    });
    const item = await createCatalogItem(ctx, { name: 'Εγκατάσταση' }, 'u1');
    expect(item.name).toBe('Εγκατάσταση');
    // Defaults + injected fields preserved exactly like the route.
    expect(captured[0]).toMatchObject({ vat_rate: 24, unit_price: 0, active: true, source: 'manual', created_by: 'u1' });
  });

  it('maps a unique-code conflict to duplicate_code (409)', async () => {
    const ctx = fakeCtx((_t, ops) =>
      ops.some((o) => o.m === 'insert') ? { data: null, error: { code: '23505' } } : { data: null, error: null });
    await expect(createCatalogItem(ctx, { name: 'Χ', code: 'DUP' }, 'u1'))
      .rejects.toMatchObject({ code: 'duplicate_code', status: 409 });
  });
});

describe('listCatalog', () => {
  it('returns mapped items', async () => {
    const ctx = fakeCtx((_t, ops) =>
      ops.some((o) => o.m === 'select') ? { data: [sampleRow], error: null } : { data: null, error: null });
    const items = await listCatalog(ctx, {});
    expect(items).toHaveLength(1);
    expect(items[0].code).toBe('A1');
  });

  it('throws catalog_query_failed on a query error', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: { message: 'boom' } }));
    await expect(listCatalog(ctx, {})).rejects.toBeInstanceOf(AppError);
  });
});
