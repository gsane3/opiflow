// Twilio Voice — OUTBOUND TwiML application endpoint.
//
// Voice "Request URL" of the Twilio TwiML App referenced by the access token's
// VoiceGrant. When the native app places an outbound call via the Twilio Voice
// SDK, Twilio POSTs here. The SDK passes the dialed number as `To` and the
// caller identity as `From = client:biz_<hex>`. We look up that business's Greek
// DID and return TwiML that Dials the number out via a <Sip> leg to our Asterisk
// (caller-ID = the DID), where `from-twilio` hands off to InterTelecom. Recording
// is enabled so the RecordingStatusCallback → AI-brief pipeline runs.
//
// ENV-GATED: until TWILIO_OUTBOUND_SIP_DOMAIN (the Asterisk SIP host, e.g.
// 46.224.138.115:5060) is set we return a safe spoken placeholder.
// Signature validated with TWILIO_AUTH_TOKEN when set (fail-closed in prod).

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

/** `biz_<32hex>` identity → business UUID. */
function identityToBusinessId(from: string): string | null {
  const m = from.match(/biz_([a-f0-9]{32})/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
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

  // Validate Twilio's signature when configured.
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (authToken) {
    const signature = request.headers.get('x-twilio-signature') ?? '';
    const signedUrl = process.env.TWILIO_OUTBOUND_WEBHOOK_URL?.trim() || request.url;
    let ok = false;
    try { ok = twilio.validateRequest(authToken, signature, signedUrl, params); } catch { ok = false; }
    if (!ok && process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
      const tw = new VoiceResponse();
      tw.reject({ reason: 'rejected' });
      return xml(tw.toString());
    }
  }

  const sipDomain = process.env.TWILIO_OUTBOUND_SIP_DOMAIN?.trim();
  const to = (params.To || params.to || params.number || '').trim();
  const tw = new VoiceResponse();

  if (!sipDomain) {
    tw.say({ language: 'el-GR' }, 'Η σύνδεση με την Opiflow λειτουργεί. Η δρομολόγηση κλήσεων ρυθμίζεται.');
    return xml(tw.toString());
  }
  if (!to) {
    tw.say({ language: 'el-GR' }, 'Δεν δόθηκε αριθμός για κλήση.');
    return xml(tw.toString());
  }

  // Resolve the calling business's Greek DID → used as caller-ID. Best-effort.
  let callerId: string | undefined;
  const businessId = identityToBusinessId(params.From || params.Caller || '');
  if (businessId) {
    try {
      const supabase = createServiceSupabaseClient();
      const { data } = await supabase
        .from('businesses')
        .select('business_phone_number')
        .eq('id', businessId)
        .maybeSingle();
      const did = (data as { business_phone_number?: string | null } | null)?.business_phone_number?.trim();
      // Match the browser path's OPIFLOW_DID (e.g. 302104400811, no leading +),
      // which InterTelecom trusts for the asserted identity (PAI/RPID).
      if (did) callerId = did.replace(/^\+/, '');
    } catch {
      // fall through — Asterisk can still route, just without the per-DID CLI
    }
  }

  const dial = tw.dial({
    answerOnBridge: true,
    callerId,
    record: 'record-from-answer-dual',
    recordingStatusCallback: process.env.TWILIO_RECORDING_WEBHOOK_URL?.trim() || undefined,
    recordingStatusCallbackEvent: ['completed'],
  });
  const digits = to.replace(/[^\d+]/g, '');
  dial.sip(`sip:${encodeURIComponent(digits)}@${sipDomain};transport=udp`);

  return xml(tw.toString());
}
