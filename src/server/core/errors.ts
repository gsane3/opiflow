// Central error model for the server layer.
//
// PR-1 foundation: this file is ADDITIVE and imported by NO live route yet, so it
// changes zero runtime behaviour. A route adopts it incrementally:
//
//   import { AppError, handleApiError, ok } from '@/server/core/errors';
//   export async function POST(req: NextRequest) {
//     try {
//       const ctx = await requireBusinessUser(req);
//       const input = CreateCustomerSchema.parse(await req.json());
//       const customer = await customersService.createCustomer(ctx, input);
//       return ok({ customer }, 201);
//     } catch (err) {
//       return handleApiError(err);
//     }
//   }
//
// The wire format is IDENTICAL to the convention already used across the app
// ({ ok:false, error:'<code>' } / { ok:true, ... }), so adopting it route-by-route
// never changes a response shape the web/native clients already parse.

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { captureException } from '../../lib/observability';

/**
 * A known, expected failure with a stable machine code and HTTP status.
 * `userMessage` (optional) is a Greek string safe to show in the UI.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly userMessage?: string;

  constructor(code: string, status: number, userMessage?: string) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
  }
}

/**
 * Success responder. Mirrors the existing `{ ok: true, ...payload }` convention
 * (fields spread at the top level, e.g. `{ ok:true, customer }` or
 * `{ ok:true, customers, count }`) so clients parse it unchanged.
 */
export function ok(payload: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

/** Failure responder for a known error code. */
export function fail(code: string, status: number, userMessage?: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: code, ...(userMessage ? { message: userMessage } : {}) },
    { status },
  );
}

/**
 * The single error funnel for route handlers. Maps:
 *   - AppError  → its own code + status (+ optional user message)
 *   - ZodError  → 400 `invalid_input` (+ per-field issues)
 *   - anything else → 500 `internal_error` (reported to Sentry; internals never leak)
 */
export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return fail(err.code, err.status, err.userMessage);
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid_input',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 400 },
    );
  }
  captureException(err, { layer: 'api' });
  return fail('internal_error', 500);
}
