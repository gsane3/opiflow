// GET  /api/snippets  → list this business's message snippets (seeds defaults if empty)
// POST /api/snippets  → create a snippet { title, body }
//
// ADOPTED to the modular pattern: thin adapter. GET delegates to the existing
// src/lib/server/snippets seeder; POST validation + insert moved to
// src/server/modules/snippets. Responses are identical (incl. GET-no-business → []).

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError, AppError } from '@/server/core/errors';
import { listSnippets } from '@/lib/server/snippets';
import { createSnippet } from '@/server/modules/snippets/snippets.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    if (err instanceof AppError && err.status === 404) return ok({ snippets: [] });
    return handleApiError(err);
  }
  try {
    const snippets = await listSnippets(ctx.businessId);
    return ok({ snippets });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('invalid_json', 400);
  }
  try {
    const snippet = await createSnippet(ctx, body as Record<string, unknown>);
    return ok({ snippet });
  } catch (err) {
    return handleApiError(err);
  }
}
