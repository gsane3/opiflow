// CRM tasks — list + create.
//
// ADOPTED to the modular pattern (src/server/modules/tasks): thin adapter. Validation
// (with the route's exact error codes), customer/offer ownership, and the insert live
// in the service; the work-folder link + customer notification are injected here so
// the service stays pure/testable. Responses are byte-identical.

import { NextRequest } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { listTasks, createTask } from '@/server/modules/tasks/tasks.service';
import { resolveWorkFolderForCreate } from '@/lib/server/folder-link';
import { notifyFolderUpdate } from '@/lib/server/notify-folder-update';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireBusinessUser(request);
  } catch (err) {
    return handleApiError(err);
  }
  try {
    const sp = request.nextUrl.searchParams;
    const tasks = await listTasks(ctx, {
      status: sp.get('status'),
      customerId: sp.get('customerId'),
      limit: sp.get('limit'),
      offset: sp.get('offset'),
    });
    return ok({ tasks, count: tasks.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return fail('unsupported_content_type', 415);

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
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('invalid_json', 400);
  }

  try {
    const task = await createTask(ctx, body as Record<string, unknown>, {
      resolveWorkFolder: (rawWf, customerId) =>
        resolveWorkFolderForCreate(ctx.supabase, ctx.businessId, rawWf, customerId),
      notifyFolderUpdate: (workFolderId, what) => {
        void notifyFolderUpdate({ businessId: ctx.businessId, workFolderId, what }).catch(() => {});
      },
    });
    return ok({ task }, 201);
  } catch (err) {
    return handleApiError(err);
  }
}
