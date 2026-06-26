// Message snippets — service (validation + create). Parity-matched to /api/snippets POST.
// (GET stays in the route, delegating to the existing src/lib/server/snippets seeder.)

import { AppError } from '../../core/errors';
import type { Snippet, SnippetRow } from './snippets.types';
import {
  countSnippets,
  deleteSnippetRow,
  insertSnippetRow,
  updateSnippetRow,
  type RepoContext,
} from './snippets.repo';

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function dbToSnippet(r: SnippetRow): Snippet {
  return { id: r.id, title: r.title, body: r.body, sortOrder: r.sort_order };
}

export async function createSnippet(ctx: RepoContext, raw: Record<string, unknown>): Promise<Snippet> {
  const title = str(raw.title);
  const text = str(raw.body);
  if (!title || !text) throw new AppError('title_and_body_required', 400);
  if (title.length > 80 || text.length > 1000) throw new AppError('too_long', 400);

  const count = await countSnippets(ctx);
  const row = await insertSnippetRow(ctx, { title, body: text, sortOrder: count });
  return dbToSnippet(row);
}

export async function updateSnippet(
  ctx: RepoContext,
  id: string,
  raw: Record<string, unknown>,
): Promise<Snippet> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('title' in raw) {
    const t = str(raw.title);
    if (!t || t.length > 80) throw new AppError('invalid_title', 400);
    updates.title = t;
  }
  if ('body' in raw) {
    const b = str(raw.body);
    if (!b || b.length > 1000) throw new AppError('invalid_body', 400);
    updates.body = b;
  }
  const row = await updateSnippetRow(ctx, id, updates);
  if (!row) throw new AppError('not_found', 404);
  return dbToSnippet(row);
}

export async function deleteSnippet(ctx: RepoContext, id: string): Promise<void> {
  await deleteSnippetRow(ctx, id);
}
