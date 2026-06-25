// POST /api/customers/[id]/intake-link
// Builds a Viber intake link for a customer.
//
// mode='draft' (default):
//   Revokes existing pending/sent tokens, creates a new pending token,
//   returns responseUrl + message + recipient without calling Apifon.
//
// mode='send':
//   If responseUrl is in the body: verifies the token hash against
//   customer_intake_tokens (scoped to this customer and business, must not
//   be revoked or expired). Uses the verified canonical URL.
//   If responseUrl is absent: revokes existing + creates a fresh token.
//   In both cases: looks up customer phone and sends via the customer's
//   PREFERRED channel — the nicer Viber action-button message when the
//   preference resolves to Viber, otherwise SMS (with Viber->SMS fallback).
//   The message TEXT always contains the link so SMS carries it too.
//
// Thin adapter: requireBusinessUser → parse body → buildIntakeLink → error-map.
// All domain logic (validation, token mint, send, timeline logging) lives in
// the customer-links service; this file only owns the HTTP shell.

import { NextRequest, NextResponse } from 'next/server';
import { requireBusinessUser } from '@/server/core/http';
import { AppError, handleApiError } from '@/server/core/errors';
import { buildIntakeLink } from '@/server/modules/customer-links/customer-links.service';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  try {
    const ctx = await requireBusinessUser(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('invalid_body', 400);
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new AppError('invalid_body', 400);
    }
    const raw = body as Record<string, unknown>;

    const { id: customerId } = await params;

    const { payload, status } = await buildIntakeLink(ctx, customerId, raw);
    return NextResponse.json({ ok: true, ...payload }, { status });
  } catch (err) {
    return handleApiError(err);
  }
}
