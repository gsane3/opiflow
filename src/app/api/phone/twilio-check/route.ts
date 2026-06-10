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

export async function GET() {
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

  return NextResponse.json({ ok: true, valid, keyError, prefixes, twimlAppSidEnv: twimlAppSid ?? '(EMPTY)', keyFriendlyName, twimlApp, inbound, pushCred, sipDomains });
}
