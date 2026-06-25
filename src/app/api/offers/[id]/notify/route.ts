// POST /api/offers/[id]/notify
//
// ADOPTED to the modular pattern (src/server/modules/offer-notify): the route keeps the
// content-type 415 guard, authentication and body/mode parsing verbatim, then hands the
// auth-scoped client, the SERVICE-ROLE client (for offer_response_tokens) and the
// effectful send/token libs to the service, which runs the draft/send orchestration and
// returns the byte-identical response.
//
// mode='draft' (default):
//   Revokes existing pending/sent tokens, creates a new pending token,
//   returns responseUrl + message + recipient without calling Apifon.
//
// mode='send':
//   If responseUrl is in the body: verifies the token hash against
//   offer_response_tokens (must match offer and business, must not be
//   revoked or expired). Uses the verified canonical URL to build the
//   message so the sent link matches what the user reviewed.
//   If responseUrl is absent: creates a fresh token as fallback.
//   In both cases: looks up customer phone and sends via the customer's
//   PREFERRED channel (Viber with SMS fallback, or SMS direct). The message
//   TEXT always carries the response URL so SMS delivers a usable link.

import { NextRequest, NextResponse } from 'next/server';
import { selectViberPhone } from '@/lib/server/viber-phone';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import {
  createServiceSupabaseClient,
  createOfferResponseToken,
  hashOfferResponseToken,
  buildOfferResponseUrl,
  markOfferResponseTokenSent,
} from '@/lib/server/offer-response-tokens';
import { normalizeApifonMsisdn } from '@/lib/server/apifon-viber';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { recordOutboundMessage } from '@/lib/server/record-message';
import { notifyOffer } from '@/server/modules/offer-notify/offer-notify.service';

export const runtime = 'nodejs';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const VALID_MODES = ['draft', 'send'] as const;
type NotificationMode = typeof VALID_MODES[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    // Optional mode (default 'draft')
    let mode: NotificationMode = 'draft';
    if (raw.mode != null) {
      const modeRaw = str(raw.mode);
      if (!modeRaw || !(VALID_MODES as readonly string[]).includes(modeRaw)) {
        return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400 });
      }
      mode = modeRaw as NotificationMode;
    }

    const { id: offerId } = await params;
    const serviceClient = createServiceSupabaseClient();

    return await notifyOffer(
      { supabase, serviceClient, businessId, offerId, mode, raw },
      {
        selectViberPhone,
        normalizeApifonMsisdn,
        sendViaPreferredChannel,
        recordOutboundMessage,
        createOfferResponseToken,
        hashOfferResponseToken,
        buildOfferResponseUrl,
        markOfferResponseTokenSent,
      },
    );
  } catch {
    return NextResponse.json({ ok: false, error: 'offer_notify_failed' }, { status: 500 });
  }
}
