// Twilio Voice — OUTBOUND TwiML application endpoint.
//
// This is the Voice "Request URL" of the Twilio TwiML App referenced by the
// access token's VoiceGrant. When the native app places an outbound call via
// the Twilio Voice SDK, Twilio POSTs here (form-urlencoded) and we return TwiML
// telling Twilio how to route the call:
//   the SDK passes the dialed number as `To`; we Dial it out through the BYOC
//   SIP trunk to Asterisk (which stamps the business's Greek DID as caller-ID
//   and hands off to InterTelecom). Recording is enabled so the existing
//   RecordingStatusCallback → AI-brief pipeline runs.
//
// ENV-GATED: until TWILIO_OUTBOUND_SIP_DOMAIN (the Asterisk-facing SIP host that
// terminates app→PSTN legs, set up with the Elastic SIP Trunk) is configured we
// return a safe spoken placeholder instead of dialing — so creating the TwiML
// App + wiring the token works before the trunk/Asterisk side is finished.
//
// Signature: validated with TWILIO_AUTH_TOKEN when set (fail-closed in prod).

import { NextRequest } from 'next/server';
import twilio from 'twilio';

export const runtime = 'nodejs';

function xml(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: NextRequest) {
  const VoiceResponse = twilio.twiml.VoiceResponse;

  // Read params + (best-effort) validate Twilio's signature.
  let params: Record<string, string> = {};
  try {
    const raw = await request.text();
    new URLSearchParams(raw).forEach((v, k) => { params[k] = v; });
  } catch {
    const tw = new VoiceResponse();
    tw.say({ language: 'el-GR' }, 'Σφάλμα αιτήματος.');
    return xml(tw.toString());
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (authToken) {
    const signature = request.headers.get('x-twilio-signature') ?? '';
    const signedUrl = process.env.TWILIO_OUTBOUND_WEBHOOK_URL?.trim() || request.url;
    let ok = false;
    try {
      ok = twilio.validateRequest(authToken, signature, signedUrl, params);
    } catch {
      ok = false;
    }
    if (!ok && process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1') {
      const tw = new VoiceResponse();
      tw.reject({ reason: 'rejected' });
      return xml(tw.toString());
    }
  }

  // The dialed number. The SDK convention passes it as `To` (or a custom param).
  const to = (params.To || params.to || params.number || '').trim();
  const sipDomain = process.env.TWILIO_OUTBOUND_SIP_DOMAIN?.trim();

  const tw = new VoiceResponse();

  if (!sipDomain) {
    // Trunk/Asterisk side not wired yet — confirm the app↔Twilio leg works.
    tw.say(
      { language: 'el-GR' },
      'Η σύνδεση με την Opiflow λειτουργεί. Η δρομολόγηση κλήσεων ρυθμίζεται.'
    );
    return xml(tw.toString());
  }

  if (!to) {
    tw.say({ language: 'el-GR' }, 'Δεν δόθηκε αριθμός για κλήση.');
    return xml(tw.toString());
  }

  // Dial out via the BYOC SIP trunk → Asterisk → InterTelecom. Asterisk applies
  // the per-DID caller-ID; recording feeds the AI-brief webhook.
  const dial = tw.dial({
    answerOnBridge: true,
    record: 'record-from-answer-dual',
    recordingStatusCallback: process.env.TWILIO_RECORDING_WEBHOOK_URL?.trim() || undefined,
    recordingStatusCallbackEvent: ['completed'],
  });
  const digits = to.replace(/[^\d+]/g, '');
  dial.sip(`sip:${encodeURIComponent(digits)}@${sipDomain}`);

  return xml(tw.toString());
}
