// Appointment notification delivery route (thin adapter).
// Builds a Viber message for an appointment task and either returns it as a
// draft (mode=draft, default) or sends it via Apifon (mode=send).
// A response token is created for 'proposal' kind so the customer can reply.
//
// IMPORTANT: mode='draft' never calls Apifon.
// mode='send' calls Apifon only after all validation passes.
// The raw response URL is embedded inside the customer message text only;
// it is not returned as a separate response field.
//
// Adopted to the modular-monolith pattern: auth → parse → service → error-map.
// All message building, validation, token mint, and Viber send live in
// src/server/modules/appointment-notifications/*. Response contract is byte-identical.

import { NextRequest, NextResponse } from 'next/server';
import { AppError, handleApiError } from '@/server/core/errors';
import { requireBusinessUser } from '@/server/core/http';
import { sendAppointmentNotification } from '@/server/modules/appointment-notifications/appointment-notifications.service';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST /api/appointment-notifications
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  try {
    const ctx = await requireBusinessUser(request);

    // Parse body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AppError('invalid_body', 400);
    }

    const result = await sendAppointmentNotification(ctx, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return handleApiError(err);
  }
}
