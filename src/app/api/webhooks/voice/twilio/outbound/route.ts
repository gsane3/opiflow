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
// Abuse hardening (signup is open, the trunk bills the owner):
//   - Signature validation FAILS CLOSED in production, including when
//     TWILIO_AUTH_TOKEN is unset (override with ALLOW_INSECURE_WEBHOOKS=1).
//   - Callers must resolve to a business with an assigned DID + an
//     activation-allowed subscription.
//   - Destinations are allowlisted: Greek geographic/mobile by default,
//     extendable via OUTBOUND_ALLOWED_DEST_REGEX.
//   - <Dial timeLimit> caps call duration (TWILIO_DIAL_TIME_LIMIT_SECONDS,
//     default 7200) and a per-business daily call cap applies
//     (OUTBOUND_DAILY_CALL_CAP, default 200/24h).
//
// Server-side call logging: the communications row is inserted HERE at dial
// time (status 'started', provider_call_id = CallSid) so the recording webhook
// always finds it — no race with the client's post-hangup /api/calls/log, which
// now UPDATES this row instead of inserting a duplicate. The <Dial action>
// callback (?leg=complete) finalises status to completed/failed.
//
// ENV-GATED: until TWILIO_OUTBOUND_SIP_DOMAIN (the Asterisk SIP host, e.g.
// 46.224.138.115:5060) is set we return a safe spoken placeholder.

import { NextRequest } from 'next/server';
import twilio from 'twilio';
import { createServiceSupabaseClient } from '@/lib/server/intake-tokens';

export const runtime = 'nodejs';

const DIAL_TIME_LIMIT_DEFAULT = 7200; // 2h — generous for a business call
const DAILY_CALL_CAP_DEFAULT = 200; // per business per rolling 24h

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

/** Mirrors /api/calls/log: normalize Greek numbers to +30 E.164 for CRM matching. */
function normalizePhone(raw: string): string | null {
  const s = raw.trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return s;
}

/**
 * Destination policy. Default allows only Greek geographic (2XXXXXXXXX) and
 * mobile (69XXXXXXXX) numbers, with or without the +30/30 prefix — which
 * excludes premium-rate (90x), international and short codes. Extend with
 * OUTBOUND_ALLOWED_DEST_REGEX (full-match regex on the cleaned digits).
 */
function destinationAllowed(digits: string): boolean {
  if (/^(\+?30)?(2\d{9}|69\d{8})$/.test(digits)) return true;
  const extra = process.env.OUTBOUND_ALLOWED_DEST_REGEX?.trim();
  if (extra) {
    try {
      if (new RegExp(`^(?:${extra})$`).test(digits)) return true;
    } catch {
      // bad env regex — ignore
    }
  }
  return false;
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

  // Validate Twilio's signature — FAIL CLOSED in production. The signed URL must
  // match what Twilio requested exactly, including the ?leg=complete query of
  // the <Dial action> callback.
  const isProd = process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_WEBHOOKS !== '1';
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const leg = request.nextUrl.searchParams.get('leg');
  const baseUrl = process.env.TWILIO_OUTBOUND_WEBHOOK_URL?.trim() || request.url.split('?')[0];
  const signedUrl = leg ? `${baseUrl}?leg=${leg}` : baseUrl;
  if (!authToken) {
    if (isProd) {
      const tw = new VoiceResponse();
      tw.reject({ reason: 'rejected' });
      return xml(tw.toString());
    }
  } else {
    const signature = request.headers.get('x-twilio-signature') ?? '';
    let ok = false;
    try { ok = twilio.validateRequest(authToken, signature, signedUrl, params); } catch { ok = false; }
    if (!ok && isProd) {
      const tw = new VoiceResponse();
      tw.reject({ reason: 'rejected' });
      return xml(tw.toString());
    }
  }

  // --- <Dial action> callback: finalise the dial-time row, then hang up. ---
  if (leg === 'complete') {
    const callSid = (params.CallSid || '').trim();
    const dialStatus = (params.DialCallStatus || '').trim();
    if (callSid) {
      try {
        const supabase = createServiceSupabaseClient();
        await supabase
          .from('communications')
          .update({ status: dialStatus === 'completed' ? 'completed' : 'failed' })
          .eq('channel', 'call')
          .eq('provider_call_id', callSid)
          .eq('status', 'started');
      } catch {
        // best-effort — the client's /api/calls/log also finalises
      }
    }
    return xml(new VoiceResponse().toString());
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

  const digits = to.replace(/[^\d+]/g, '');
  if (!destinationAllowed(digits)) {
    tw.say({ language: 'el-GR' }, 'Ο αριθμός δεν επιτρέπεται από την πολιτική κλήσεων.');
    return xml(tw.toString());
  }

  // The caller identity must resolve to one of OUR businesses — tokens only ever
  // mint `biz_<hex>` identities, so anything else is not a legitimate caller.
  const businessId = identityToBusinessId(params.From || params.Caller || '');
  if (!businessId) {
    tw.say({ language: 'el-GR' }, 'Μη έγκυρη ταυτότητα κλήσης.');
    return xml(tw.toString());
  }

  // Resolve the business's Greek DID (caller-ID) + enforce the daily cap, and
  // insert the dial-time communications row the recording webhook will match.
  let callerId: string | undefined;
  const callSid = (params.CallSid || '').trim();
  try {
    const supabase = createServiceSupabaseClient();

    const { data } = await supabase
      .from('businesses')
      .select('business_phone_number')
      .eq('id', businessId)
      .maybeSingle();
    const did = (data as { business_phone_number?: string | null } | null)?.business_phone_number?.trim();
    if (!did) {
      // No DID = not an activated line; refuse rather than dialing anonymously.
      tw.say({ language: 'el-GR' }, 'Η γραμμή δεν είναι ενεργοποιημένη.');
      return xml(tw.toString());
    }
    // Match the browser path's OPIFLOW_DID (e.g. 302104400811, no leading +),
    // which InterTelecom trusts for the asserted identity (PAI/RPID).
    callerId = did.replace(/^\+/, '');

    const cap = Number(process.env.OUTBOUND_DAILY_CALL_CAP?.trim() || DAILY_CALL_CAP_DEFAULT);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await supabase
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('channel', 'call')
      .eq('direction', 'outbound')
      .gte('created_at', since);
    if ((count ?? 0) >= cap) {
      tw.say({ language: 'el-GR' }, 'Συμπληρώθηκε το ημερήσιο όριο κλήσεων.');
      return xml(tw.toString());
    }

    // Dial-time call log (server-side, so it exists before any webhook races).
    if (callSid) {
      const phone = normalizePhone(digits);
      let customerId: string | null = null;
      if (phone) {
        const { data: cust } = await supabase
          .from('customers')
          .select('id')
          .eq('business_id', businessId)
          .or(`phone.eq.${phone},mobile_phone.eq.${phone},landline_phone.eq.${phone}`)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        customerId = (cust as { id: string } | null)?.id ?? null;
      }
      const { error: insertError } = await supabase.from('communications').insert({
        business_id: businessId,
        customer_id: customerId,
        channel: 'call',
        direction: 'outbound',
        status: 'started',
        phone,
        summary: 'Εξερχόμενη κλήση',
        provider_call_id: callSid,
      });
      if (insertError) {
        // Pre-038 schema fallback: keep the call working, lose only exact matching.
        await supabase.from('communications').insert({
          business_id: businessId,
          customer_id: customerId,
          channel: 'call',
          direction: 'outbound',
          status: 'started',
          phone,
          summary: `Εξερχόμενη κλήση\ntwilio_sid=${callSid}`,
        });
      }
    }
  } catch {
    // Supabase outage: fail open for the call itself (the owner's line must
    // keep working) — recording/brief matching degrades gracefully.
  }

  const timeLimit = Number(process.env.TWILIO_DIAL_TIME_LIMIT_SECONDS?.trim() || DIAL_TIME_LIMIT_DEFAULT);
  const dial = tw.dial({
    answerOnBridge: true,
    callerId,
    timeLimit,
    action: `${baseUrl}?leg=complete`,
    record: 'record-from-answer-dual',
    recordingStatusCallback: process.env.TWILIO_RECORDING_WEBHOOK_URL?.trim() || undefined,
    recordingStatusCallbackEvent: ['completed'],
  });
  dial.sip(`sip:${encodeURIComponent(digits)}@${sipDomain};transport=udp`);

  return xml(tw.toString());
}
