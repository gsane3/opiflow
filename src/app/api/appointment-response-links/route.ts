// Authenticated API route for generating appointment response links.
// This route only creates a secure response link and returns it to the caller.
// It does not send any message, email, Viber, SMS, or external notification.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { createAppointmentResponseToken } from '@/lib/server/appointment-response-tokens';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ---------------------------------------------------------------------------
// POST /api/appointment-response-links
// ---------------------------------------------------------------------------

const VALID_SENT_CHANNELS = ['manual', 'email', 'viber', 'sms'] as const;
type SentChannel = typeof VALID_SENT_CHANNELS[number];

const VALID_APPOINTMENT_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;

function isValidSentChannel(val: unknown): val is SentChannel {
  return typeof val === 'string' && (VALID_SENT_CHANNELS as readonly string[]).includes(val);
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_content_type' },
      { status: 415 }
    );
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    // Required: taskId
    const taskId = str(raw.taskId);
    if (!taskId) {
      return NextResponse.json({ ok: false, error: 'invalid_task_id' }, { status: 400 });
    }

    // Optional: sentChannel (default 'manual')
    let sentChannel: SentChannel = 'manual';
    if (raw.sentChannel != null) {
      if (!isValidSentChannel(raw.sentChannel)) {
        return NextResponse.json({ ok: false, error: 'invalid_sent_channel' }, { status: 400 });
      }
      sentChannel = raw.sentChannel;
    }

    // Optional: sentTo
    const sentTo = raw.sentTo != null ? str(raw.sentTo) : null;

    // Optional: expiryHours (integer, 1-168)
    let expiryHours: number | undefined;
    if (raw.expiryHours != null) {
      const parsed = typeof raw.expiryHours === 'number' ? raw.expiryHours : NaN;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
        return NextResponse.json({ ok: false, error: 'invalid_expiry_hours' }, { status: 400 });
      }
      expiryHours = parsed;
    }

    // ---------------------------------------------------------------------------
    // Validate appointment task: ownership + type + status
    // ---------------------------------------------------------------------------

    interface TaskCheckRow {
      id: string;
      business_id: string;
      customer_id: string | null;
      type: string;
      status: string;
    }

    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('id, business_id, customer_id, type, status')
      .eq('id', taskId)
      .eq('business_id', businessId)
      .maybeSingle();

    if (taskError) {
      return NextResponse.json(
        { ok: false, error: 'appointment_response_link_create_failed' },
        { status: 500 }
      );
    }

    if (!taskData) {
      return NextResponse.json({ ok: false, error: 'task_not_found' }, { status: 404 });
    }

    const task = taskData as unknown as TaskCheckRow;

    if (!(VALID_APPOINTMENT_TASK_TYPES as readonly string[]).includes(task.type)) {
      return NextResponse.json({ ok: false, error: 'invalid_task_type' }, { status: 400 });
    }

    if (task.status !== 'open') {
      return NextResponse.json({ ok: false, error: 'invalid_task_status' }, { status: 400 });
    }

    // ---------------------------------------------------------------------------
    // Create response token and link
    // ---------------------------------------------------------------------------

    let result: Awaited<ReturnType<typeof createAppointmentResponseToken>>;
    try {
      result = await createAppointmentResponseToken({
        businessId,
        taskId,
        sentChannel,
        sentTo,
        expiryHours,
      });
    } catch {
      return NextResponse.json(
        { ok: false, error: 'appointment_response_link_create_failed' },
        { status: 500 }
      );
    }

    // Return responseUrl and safe token metadata only.
    // rawToken and tokenHash are never returned to the client.
    return NextResponse.json(
      {
        ok: true,
        responseUrl: result.responseUrl,
        token: {
          id: result.row.id,
          status: result.row.status,
          sentChannel: result.row.sent_channel,
          sentTo: result.row.sent_to,
          expiresAt: result.row.expires_at,
          taskId: result.row.task_id,
        },
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'appointment_response_link_create_failed' },
      { status: 500 }
    );
  }
}
