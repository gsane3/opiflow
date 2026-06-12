// Twilio Voice — INBOUND TwiML endpoint (ring the app on incoming Greek-DID calls).
//
// Flow: InterTelecom DID → Asterisk → (Twilio SIP trunk/Domain) → THIS webhook.
// Asterisk dials a Twilio SIP Domain as `sip:biz_<hex>@<domain>.sip.twilio.com`,
// where `biz_<hex>` is the SAME Client identity the app registered with via
// GET /api/phone/twilio-token. Twilio fires this webhook; we return TwiML that
// <Dial>s that <Client>, so Twilio rings the registered device — and, because the
// access token carries a Push Credential, fires the VoIP push that wakes the app
// even when backgrounded/killed (CallKit on iOS, full-screen intent on Android).
//
// The <Dial> records the leg so the existing RecordingStatusCallback → AI-brief
// pipeline runs for inbound calls too. The customer's number is passed as the
// Client callerId so the app shows who is calling (and can match the CRM record).
//
// Owner setup (see docs/NATIVE_CALLING_PLAN.md → "Inbound runbook"):
//   • Twilio SIP Domain → Voice Configuration → Request URL = this endpoint.
//   • Asterisk inbound dialplan: DID → Dial(PJSIP/<twilio-trunk>/biz_<id>).
//   • Twilio Push Credential (APNs VoIP .p8 + FCM) → TWILIO_PUSH_CREDENTIAL_SID.
//
// ENV-GATED + signature-validated (fail-closed in prod when TWILIO_AUTH_TOKEN set,
// matching the outbound webhook). Always returns valid TwiML.

import { NextRequest } from 'next/server';
import twilio from 'twilio';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';

export const runtime = 'nodejs';

function xml(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Pull the `biz_<32hex>` Client identity out of a SIP URI / param. */
function extractClientIdentity(value: string): string | null {
  const m = value.match(/biz_[a-f0-9]{32}/i);
  return m ? m[0].toLowerCase() : null;
}

/** Best-effort caller number for display in-app (digits / +digits). */
function extractCaller(value: string): string | undefined {
  const stripped = value.replace(/^sip:/i, '').replace(/@.*$/, '');
  const cleaned = stripped.replace(/[^\d+]/g, '');
  return cleaned.length >= 5 ? cleaned : undefined;
}

export async function POST(request: NextRequest) {
  const VoiceResponse = twilio.twiml.VoiceResponse;

  let params: Record<string, string> = {};
  try {
    const raw = await request.text();
    new URLSearchParams(raw).forEach((v, k) => { params[k] = v; });
  } catch {
    const tw = new VoiceResponse();
    tw.say({ language: 'el-GR' }, 'Σφάλμα αιτήματος.');
    return xml(tw.toString());
  }

  // Validate Twilio's signature — FAIL CLOSED in production, including when
  // TWILIO_AUTH_TOKEN is missing (override with ALLOW_INSECURE_WEBHOOKS=1).
  const isProd = process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1';
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) {
    if (isProd) {
      const tw = new VoiceResponse();
      tw.reject({ reason: 'rejected' });
      return xml(tw.toString());
    }
  } else {
    const signature = request.headers.get('x-twilio-signature') ?? '';
    const signedUrl = process.env.TWILIO_INBOUND_WEBHOOK_URL?.trim() || request.url;
    let ok = false;
    try { ok = twilio.validateRequest(authToken, signature, signedUrl, params); } catch { ok = false; }
    if (!ok && isProd) {
      const tw = new VoiceResponse();
      tw.reject({ reason: 'rejected' });
      return xml(tw.toString());
    }
  }

  const tw = new VoiceResponse();

  // Which registered device to ring? Parse biz_<hex> from the dialed SIP user.
  const identity =
    extractClientIdentity(params.To || '') ||
    extractClientIdentity(params.Called || '') ||
    extractClientIdentity(params.SipDomain || '');

  if (!identity) {
    // No app target resolved — let the carrier path handle it (don't trap the call).
    tw.say({ language: 'el-GR' }, 'Η κλήση δεν μπορεί να δρομολογηθεί αυτή τη στιγμή.');
    return xml(tw.toString());
  }

  // Respect the owner's DND switch (business_user_presence — settable from the
  // web TelephonyPanel). Rejecting as busy keeps the Asterisk DIALSTATUS=BUSY,
  // so the PBX webhook still logs the call as missed → call-back task + push.
  // Fail-open on any DB hiccup: the line ringing matters more than the switch.
  try {
    const hex = identity.slice(4);
    const businessId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const supabase = createServiceSupabaseClient();
    const { data: biz } = await supabase
      .from('businesses')
      .select('owner_id')
      .eq('id', businessId)
      .maybeSingle();
    const ownerId = (biz as { owner_id?: string } | null)?.owner_id;
    if (ownerId) {
      const { data: presence } = await supabase
        .from('business_user_presence')
        .select('status')
        .eq('business_id', businessId)
        .eq('user_id', ownerId)
        .maybeSingle();
      if ((presence as { status?: string } | null)?.status === 'dnd') {
        tw.reject({ reason: 'busy' });
        return xml(tw.toString());
      }
    }
  } catch {
    // fail-open — ring the device
  }

  // Show the real caller's number in-app (and let the CRM match it).
  const callerId = extractCaller(params.From || params.Caller || '');

  // NOTE: no `record` here on purpose. Inbound calls traverse Asterisk, whose
  // MixMonitor already records the leg and feeds /api/webhooks/voice/pbx-recording
  // — a Twilio-side recording would be a duplicate (double per-minute cost) that
  // can never match a communications row (PBX rows carry uniqueid, not CallSid).
  const dial = tw.dial({
    answerOnBridge: true,
    callerId,
    // Don't let an unanswered call ring the device forever.
    timeout: 30,
  });
  dial.client(identity);

  return xml(tw.toString());
}
