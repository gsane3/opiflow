// Service catalog — service (validation + orchestration).
//
// Adoption note: this preserves the live route's behaviour EXACTLY, including its
// lenient coercion (unitPrice/vatRate fall back to 0/24 instead of erroring) and its
// specific error codes (invalid_name / duplicate_code). It deliberately does NOT use
// strict Zod parsing here, because that would reject inputs the current route accepts
// — i.e. it would change the response contract. Tightening to Zod is a separate,
// intentional contract change, not part of a zero-impact adoption.

import { CATALOG_SOURCES, type CatalogItem, type CatalogRow } from './catalog.types';
import { AppError } from '../../core/errors';
import {
  insertCatalogRow,
  listCatalogRows,
  type ListCatalogParams,
  type RepoContext,
} from './catalog.repo';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function nonNegNumber(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return isFinite(n) && n >= 0 ? n : fallback;
}

export function dbToItem(r: CatalogRow): CatalogItem {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    category: r.category,
    unit: r.unit,
    unitPrice: r.unit_price,
    vatRate: r.vat_rate,
    active: r.active,
    source: r.source,
    createdAt: r.created_at,
  };
}

export async function listCatalog(ctx: RepoContext, params: ListCatalogParams): Promise<CatalogItem[]> {
  const rows = await listCatalogRows(ctx, params);
  return rows.map(dbToItem);
}

export async function createCatalogItem(
  ctx: RepoContext,
  raw: Record<string, unknown>,
  userId: string,
): Promise<CatalogItem> {
  const name = str(raw.name);
  if (!name) throw new AppError('invalid_name', 400);

  const sourceRaw = str(raw.source);
  const source = sourceRaw && (CATALOG_SOURCES as readonly string[]).includes(sourceRaw) ? sourceRaw : 'manual';

  const row = await insertCatalogRow(ctx, {
    code: str(raw.code),
    name,
    description: str(raw.description),
    category: str(raw.category),
    unit: str(raw.unit),
    unit_price: nonNegNumber(raw.unitPrice, 0),
    vat_rate: nonNegNumber(raw.vatRate, 24),
    active: raw.active === false ? false : true,
    source,
    created_by: userId,
    updated_at: new Date().toISOString(),
  });

  return dbToItem(row);
}
