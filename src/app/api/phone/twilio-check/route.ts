// GET /api/phone/twilio-check
//
// Temporary diagnostic: validates the configured Twilio Voice credentials
// (TWILIO_ACCOUNT_SID + TWILIO_API_KEY + TWILIO_API_SECRET) by making a
// lightweight authenticated call to Twilio, and confirms the TwiML App exists.
// Returns NO secrets — only prefixes + a validity boolean + the Twilio error
// code when invalid. Remove once in-app calling is verified.

import { NextResponse } from 'next/server';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const apiKey = process.env.TWILIO_API_KEY?.trim();
  const apiSecret = process.env.TWILIO_API_SECRET?.trim();
  const twimlAppSid = process.env.TWILIO_TWIML_APP_SID?.trim();

  const has = { accountSid: !!accountSid, apiKey: !!apiKey, apiSecret: !!apiSecret, twimlAppSid: !!twimlAppSid };

  // Inbound/push diagnostic: a missing iOS push credential means the Voice token
  // carries no pushCredentialSid, so voice.register() can't bind the device and
  // Twilio's <Dial><Client> returns 404 — exactly the symptom we're chasing.
  const sidTail = (v?: string) => (v && v.trim() ? v.trim().slice(0, 4) + '…' + v.trim().slice(-4) : '(unset)');
  const inbound = {
    pushCredIos: sidTail(process.env.TWILIO_PUSH_CREDENTIAL_SID_IOS),
    pushCredAndroid: sidTail(process.env.TWILIO_PUSH_CREDENTIAL_SID_ANDROID),
    pushCredFallback: sidTail(process.env.TWILIO_PUSH_CREDENTIAL_SID),
    inboundWebhookUrl: process.env.TWILIO_INBOUND_WEBHOOK_URL?.trim() || '(unset)',
    authTokenSet: !!process.env.TWILIO_AUTH_TOKEN?.trim(),
    recordingWebhookSet: !!process.env.TWILIO_RECORDING_WEBHOOK_URL?.trim(),
  };

  if (!accountSid || !apiKey || !apiSecret) {
    return NextResponse.json({ ok: false, error: 'missing_env', has, inbound });
  }

  const prefixes = {
    accountSid: accountSid.slice(0, 6) + '…' + accountSid.slice(-2),
    apiKey: apiKey.slice(0, 6) + '…' + apiKey.slice(-2),
  };

  const client = twilio(apiKey, apiSecret, { accountSid });

  // Validate the key (a region quirk can throw a false-negative — non-fatal,
  // so the deep checks below always run).
  let valid = false;
  let keyFriendlyName: string | null = null;
  let keyError: string | null = null;
  try {
    const key = await client.keys(apiKey).fetch();
    valid = true;
    keyFriendlyName = key.friendlyName;
  } catch (e) {
    keyError = (e as { message?: string })?.message?.slice(0, 160) ?? 'key_fetch_failed';
  }

  let twimlApp: Record<string, unknown> = { ok: false };
  if (twimlAppSid) {
    try {
      const app = await client.applications(twimlAppSid).fetch();
      twimlApp = { sid: twimlAppSid, ok: true, friendlyName: app.friendlyName, voiceUrl: app.voiceUrl || '(EMPTY)', voiceMethod: app.voiceMethod || '(none)' };
    } catch (e) {
      twimlApp = { sid: twimlAppSid, ok: false, code: (e as { code?: number })?.code ?? 'fetch_failed' };
    }
  }

  // Deep inbound check — the iOS push credential's sandbox flag (a production
  // build needs sandbox=false) + SIP domains (same account + voiceUrl).
  let pushCred: Record<string, unknown> = { checked: false };
  const iosCredSid = process.env.TWILIO_PUSH_CREDENTIAL_SID_IOS?.trim();
  if (iosCredSid) {
    try {
      const c = await client.notify.v1.credentials(iosCredSid).fetch();
      pushCred = { sid: c.sid, type: c.type, sandbox: (c as { sandbox?: unknown }).sandbox, friendlyName: c.friendlyName };
    } catch (e) {
      pushCred = { error: (e as { message?: string })?.message?.slice(0, 160), code: (e as { code?: number })?.code ?? null };
    }
  }
  let sipDomains: unknown = '(not checked)';
  try {
    const doms = await client.sip.domains.list({ limit: 20 });
    sipDomains = doms.map((d) => ({ domainName: d.domainName, voiceUrl: d.voiceUrl, voiceMethod: d.voiceMethod }));
  } catch (e) {
    sipDomains = { error: (e as { message?: string })?.message?.slice(0, 160) };
  }

  // Recent Twilio errors (Monitor alerts) — the authoritative reason a <Client>
  // dial fails (e.g. push delivery / no registration). + recent calls.
  let alerts: unknown = '(not checked)';
  try {
    const a = await client.monitor.v1.alerts.list({ limit: 12 });
    alerts = a.map((x) => ({ code: x.errorCode, level: x.logLevel, text: (x.alertText || '').slice(0, 180), at: x.dateGenerated }));
  } catch (e) {
    alerts = { error: (e as { message?: string })?.message?.slice(0, 160) };
  }
  let calls: unknown = '(not checked)';
  try {
    const cs = await client.calls.list({ limit: 6 });
    calls = cs.map((c) => ({ to: c.to, from: c.from, status: c.status, direction: c.direction, at: c.startTime }));
  } catch (e) {
    calls = { error: (e as { message?: string })?.message?.slice(0, 160) };
  }

  let numbers: unknown = '(not checked)';
  let twilioNumber: string | undefined;
  try {
    const ns = await client.incomingPhoneNumbers.list({ limit: 5 });
    numbers = ns.map((n) => n.phoneNumber);
    twilioNumber = ns[0]?.phoneNumber;
  } catch (e) {
    numbers = { error: (e as { message?: string })?.message?.slice(0, 160) };
  }

  // Direct registration test (?ring=1): Twilio calls the registered client
  // directly, bypassing Asterisk + the SIP domain. If the phone rings, the push
  // registration works and the SIP-domain path is the issue; if not, the
  // registration itself is unreachable.
  let ringTest: unknown = '(skip — add ?ring=1)';
  const url = new URL(request.url);
  if (url.searchParams.get('ring') === '1') {
    const identity = url.searchParams.get('id')?.trim() || 'biz_44892a77cce34a268e3d13c99071b413';
    try {
      const call = await client.calls.create({
        to: `client:${identity}`,
        from: twilioNumber || identity,
        twiml: '<Response><Say voice="alice" language="el-GR">Δοκιμή Opiflow.</Say><Pause length="20"/></Response>',
      });
      ringTest = { sid: call.sid, status: call.status, to: `client:${identity}`, from: twilioNumber || `(no number) ${identity}` };
    } catch (e) {
      ringTest = { error: (e as { message?: string })?.message?.slice(0, 200), code: (e as { code?: number })?.code ?? null };
    }
  }

  return NextResponse.json({ ok: true, valid, keyError, prefixes, twimlAppSidEnv: twimlAppSid ?? '(EMPTY)', keyFriendlyName, twimlApp, inbound, pushCred, sipDomains, alerts, calls, numbers, ringTest });
}
