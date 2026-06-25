// Message snippets — service (validation + create). Parity-matched to /api/snippets POST.
// (GET stays in the route, delegating to the existing src/lib/server/snippets seeder.)

import { AppError } from '../../core/errors';
import type { Snippet, SnippetRow } from './snippets.types';
import { countSnippets, insertSnippetRow, type RepoContext } from './snippets.repo';

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
