// Service catalog — DB row + API DTO types. Mirrors /api/catalog exactly.

export const CATALOG_COLUMNS =
  'id, code, name, description, category, unit, unit_price, vat_rate, active, source, created_at';

export interface CatalogRow {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  unit_price: number;
  vat_rate: number;
  active: boolean;
  source: string;
  created_at: string;
}

export interface CatalogItem {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  category: string | null;
  unit: string | null;
  unitPrice: number;
  vatRate: number;
  active: boolean;
  source: string;
  createdAt: string;
}

export const CATALOG_SOURCES = ['manual', 'ai_chat', 'file_import'] as const;
