import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

// GET /api/phone/twilio-token
//
// Mints a short-lived Twilio Voice **access token** (JWT) for the authenticated
// business, used by the native app's Twilio Voice SDK (via the Capacitor plugin)
// to place + receive in-app calls. The identity is the business's stable SIP
// identity `biz_<id>` — the SAME identity Asterisk dials on the Twilio trunk for
// inbound, so an incoming Greek-DID call rings this device.
//
// ENV-GATED + INERT: until the Twilio env vars below are set the route returns
// { ok:true, ready:false, reason:'twilio_not_configured' } — exactly like the
// other optional integrations — so nothing breaks before Twilio is wired.
//
// Required env (server-only; never logged or returned):
//   TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID
// Optional (Push Credential = the key that lets an inbound call ring a killed app;
// harmless to omit for outbound-only). A Voice token carries ONE pushCredentialSid,
// and iOS (APNs VoIP) vs Android (FCM) need DIFFERENT credentials, so the client
// passes ?platform=ios|android and we pick the matching SID:
//   TWILIO_PUSH_CREDENTIAL_SID_IOS, TWILIO_PUSH_CREDENTIAL_SID_ANDROID
//   TWILIO_PUSH_CREDENTIAL_SID      (fallback when only one platform is wired)

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const TOKEN_TTL_SECONDS = 3600;

/** Stable, Twilio-safe Client identity for a business: `biz_<hex>`. */
function businessIdentity(businessId: string): string {
  return `biz_${businessId.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  // Same gates as /api/phone/browser-token: a Voice token lets the holder place
  // outbound calls through the TwiML App (toll-fraud surface), so it is only
  // issued to a business with an assigned number AND an activation-allowed
  // subscription — never to a bare self-signup account.
  const { data: bizRow } = await supabase
    .from('businesses')
    .select('business_phone_number')
    .eq('id', businessId)
    .maybeSingle();
  if (!(bizRow as { business_phone_number?: string | null } | null)?.business_phone_number) {
    return NextResponse.json(
      { ok: false, ready: false, error: 'no_number_assigned' },
      { status: 409, headers: NO_STORE }
    );
  }
  const { data: subRow } = await supabase
    .from('business_subscriptions')
    .select('status')
    .eq('business_id', businessId)
    .maybeSingle();
  const subStatus = (subRow as { status?: string } | null)?.status ?? null;
  if (!subStatus || !['pending_manual_review', 'trialing', 'active'].includes(subStatus)) {
    return NextResponse.json(
      { ok: false, ready: false, error: 'activation_required' },
      { status: 403, headers: NO_STORE }
    );
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKey = process.env.TWILIO_API_KEY?.trim();
  const apiSecret = process.env.TWILIO_API_SECRET?.trim();
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID?.trim();

  // Pick the Push Credential matching the caller's platform (iOS=APNs VoIP,
  // Android=FCM); fall back to the single TWILIO_PUSH_CREDENTIAL_SID.
  const platform = request.nextUrl.searchParams.get('platform');
  const pushCredentialSid =
    (platform === 'ios' ? process.env.TWILIO_PUSH_CREDENTIAL_SID_IOS?.trim() : undefined) ||
    (platform === 'android' ? process.env.TWILIO_PUSH_CREDENTIAL_SID_ANDROID?.trim() : undefined) ||
    process.env.TWILIO_PUSH_CREDENTIAL_SID?.trim() ||
    undefined;

  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    return NextResponse.json(
      { ok: true, ready: false, reason: 'twilio_not_configured' },
      { headers: NO_STORE }
    );
  }

  try {
    const { AccessToken } = twilio.jwt;
    const VoiceGrant = AccessToken.VoiceGrant;

    const identity = businessIdentity(businessId);
    // Pin the Twilio Region (twr header). Without it the Voice SDK may register
    // the device for incoming push in a default/global region that the us1 SIP
    // Domain's <Dial><Client> lookup never checks — the device registers "OK" but
    // Twilio finds no client and returns 404 with no push attempted. All our
    // resources (SIP Domain opiflow.sip.us1.twilio.com, push cred) are us1.
    const region = process.env.TWILIO_REGION?.trim() || 'us1';
    const token = new AccessToken(accountSid, apiKey, apiSecret, {
      identity,
      ttl: TOKEN_TTL_SECONDS,
      region,
    });
    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: twimlAppSid,
        pushCredentialSid,
        incomingAllow: true,
      })
    );

    // `pushConfigured` (boolean only — never the SID) lets the app tell the
    // owner whether incoming calls can ring when the app is killed. Without a
    // push credential for this platform, the device registers but Twilio fires
    // NO VoIP/FCM push, so a closed app never rings. Surfaced in Ρυθμίσεις.
    return NextResponse.json(
      {
        ok: true,
        ready: true,
        token: token.toJwt(),
        identity,
        ttl: TOKEN_TTL_SECONDS,
        pushConfigured: Boolean(pushCredentialSid),
      },
      { headers: NO_STORE }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'twilio_token_failed' },
      { status: 500, headers: NO_STORE }
    );
  }
}
