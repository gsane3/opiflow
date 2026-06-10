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
  // FULL SIP-domain dump: the inbound INVITE is rejected pre-TwiML (no webhook
  // hit, no call record), so the answer lives in the domain's own attributes —
  // sipRegistration routing, auth mappings, byocTrunkSid, fallback, etc.
  let sipDomains: unknown = '(not checked)';
  try {
    const doms = await client.sip.domains.list({ limit: 20 });
    sipDomains = await Promise.all(
      doms.map(async (d) => {
        let ipAclMappings: unknown = [];
        let credListMappings: unknown = [];
        let regCredListMappings: unknown = [];
        try {
          ipAclMappings = (await client.sip.domains(d.sid).auth.calls.ipAccessControlListMappings.list({ limit: 10 })).map((m) => m.friendlyName);
        } catch (e) { ipAclMappings = { error: (e as { message?: string })?.message?.slice(0, 100) }; }
        try {
          credListMappings = (await client.sip.domains(d.sid).auth.calls.credentialListMappings.list({ limit: 10 })).map((m) => m.friendlyName);
        } catch (e) { credListMappings = { error: (e as { message?: string })?.message?.slice(0, 100) }; }
        try {
          regCredListMappings = (await client.sip.domains(d.sid).auth.registrations.credentialListMappings.list({ limit: 10 })).map((m) => m.friendlyName);
        } catch (e) { regCredListMappings = { error: (e as { message?: string })?.message?.slice(0, 100) }; }
        return {
          sid: d.sid,
          domainName: d.domainName,
          voiceUrl: d.voiceUrl,
          voiceMethod: d.voiceMethod,
          voiceFallbackUrl: d.voiceFallbackUrl || '(none)',
          voiceStatusCallbackUrl: d.voiceStatusCallbackUrl || '(none)',
          sipRegistration: d.sipRegistration,
          emergencyCallingEnabled: d.emergencyCallingEnabled,
          secure: d.secure,
          byocTrunkSid: d.byocTrunkSid || '(none)',
          authType: d.authType || '(none)',
          ipAclMappings,
          credListMappings,
          regCredListMappings,
        };
      }),
    );
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

  let account: unknown = '(not checked)';
  try {
    const a = await client.api.accounts(accountSid).fetch();
    account = { type: a.type, status: a.status, friendlyName: a.friendlyName };
  } catch (e) {
    account = { error: (e as { message?: string })?.message?.slice(0, 160) };
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

  // Region probe (?region=ie1): Twilio resources are REGION-scoped and the
  // default API only sees US1. Session 13 "moved IE1→US1" — if the old IE1 SIP
  // domain still exists, it intercepts the INVITE, its <Client> lookup searches
  // IE1 registrations (the app registers in US1) → 404, and all evidence lives
  // in IE1 (invisible to every US1 query we ran). Probe that region directly.
  let regionProbe: unknown = '(skip — add ?region=ie1)';
  const regionUrl = new URL(request.url);
  const probeRegion = regionUrl.searchParams.get('region')?.trim();
  if (probeRegion) {
    try {
      const rc = twilio(apiKey, apiSecret, { accountSid, region: probeRegion });
      let rDomains: unknown = [];
      try {
        rDomains = (await rc.sip.domains.list({ limit: 20 })).map((d) => ({
          sid: d.sid, domainName: d.domainName, voiceUrl: d.voiceUrl || '(EMPTY)', voiceMethod: d.voiceMethod, sipRegistration: d.sipRegistration, authType: d.authType || '(none)',
        }));
      } catch (e) { rDomains = { error: (e as { message?: string })?.message?.slice(0, 160) }; }
      let rCalls: unknown = [];
      try {
        rCalls = (await rc.calls.list({ limit: 8 })).map((c) => ({ to: c.to, from: c.from, status: c.status, direction: c.direction, at: c.startTime }));
      } catch (e) { rCalls = { error: (e as { message?: string })?.message?.slice(0, 160) }; }
      let rCall: unknown = '(no ?call given)';
      const rSid = regionUrl.searchParams.get('call')?.trim();
      if (rSid) {
        try {
          const c = await rc.calls(rSid).fetch();
          let rNotifications: unknown = [];
          try {
            rNotifications = (await rc.calls(rSid).notifications.list({ limit: 10 })).map((n) => ({ code: n.errorCode, at: n.messageDate, text: (n.messageText || '').slice(0, 300) }));
          } catch (e) { rNotifications = { error: (e as { message?: string })?.message?.slice(0, 120) }; }
          rCall = { sid: c.sid, status: c.status, direction: c.direction, from: c.from, to: c.to, startTime: c.startTime, notifications: rNotifications };
        } catch (e) {
          rCall = { error: (e as { message?: string })?.message?.slice(0, 160), code: (e as { code?: number })?.code ?? null };
        }
      }
      let rAlerts: unknown = [];
      try {
        rAlerts = (await rc.monitor.v1.alerts.list({ limit: 10 })).map((x) => ({ code: x.errorCode, text: (x.alertText || '').slice(0, 220), at: x.dateGenerated }));
      } catch (e) { rAlerts = { error: (e as { message?: string })?.message?.slice(0, 120) }; }
      regionProbe = { region: probeRegion, sipDomains: rDomains, call: rCall, recentCalls: rCalls, alerts: rAlerts };
    } catch (e) {
      regionProbe = { region: probeRegion, error: (e as { message?: string })?.message?.slice(0, 200) };
    }
  }

  // Call probe (?call=CAxxx): fetch a specific call + its error notifications +
  // webhook events. The inbound SIP 404 carries an X-Twilio-CallSid that does
  // NOT appear in our calls.list — if this fetch 20404s, the call lives in a
  // DIFFERENT account (the smoking gun); if it exists, events show the TwiML.
  let callProbe: unknown = '(skip — add ?call=CAxxx)';
  const probeUrl = new URL(request.url);
  const probeSid = probeUrl.searchParams.get('call')?.trim();
  if (probeSid) {
    try {
      const c = await client.calls(probeSid).fetch();
      let notifications: unknown = [];
      try {
        notifications = (await client.calls(probeSid).notifications.list({ limit: 10 })).map((n) => ({
          code: n.errorCode, log: n.log, at: n.messageDate, text: (n.messageText || '').slice(0, 300),
        }));
      } catch (e) { notifications = { error: (e as { message?: string })?.message?.slice(0, 120) }; }
      let events: unknown = [];
      try {
        events = (await client.calls(probeSid).events.list({ limit: 10 })).map((ev) => {
          const raw = ev as unknown as { request?: unknown; response?: unknown };
          return { request: raw.request, response: raw.response };
        });
      } catch (e) { events = { error: (e as { message?: string })?.message?.slice(0, 120) }; }
      callProbe = {
        sid: c.sid, status: c.status, direction: c.direction, from: c.from, to: c.to,
        startTime: c.startTime, duration: c.duration, accountSid: sidTail(c.accountSid),
        notifications, events,
      };
    } catch (e) {
      callProbe = {
        error: (e as { message?: string })?.message?.slice(0, 200),
        code: (e as { code?: number })?.code ?? null,
        meaning: 'If 20404: the call exists in a DIFFERENT Twilio account than this API key/account.',
      };
    }
  }

  // Direct registration test (?ring=1): Twilio calls the registered client
  // directly, bypassing Asterisk + the SIP domain. If the phone rings, the push
  // registration works and the SIP-domain path is the issue; if not, the
  // registration itself is unreachable.
  let ringTest: unknown = '(skip — add ?ring=1)';
  const url = new URL(request.url);
  if (url.searchParams.get('ring') === '1') {
    const identity = url.searchParams.get('id')?.trim() || 'biz_44892a77cce34a268e3d13c99071b413';
    // For client targets `from` may be `client:<name>` — no Twilio number needed.
    const from = twilioNumber || 'client:diag';
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      const call = await client.calls.create({
        to: `client:${identity}`,
        from,
        timeout: 25,
        twiml: '<Response><Say voice="alice" language="el-GR">Δοκιμή Opiflow.</Say><Pause length="20"/></Response>',
      });
      // Poll the call's fate: ringing/in-progress = the push BINDING EXISTS and
      // the device was reachable; failed/no-answer in <8s = no usable binding.
      const timeline: Array<{ t: string; status: string }> = [{ t: '0s', status: call.status }];
      for (const [t, ms] of [['3s', 3000], ['8s', 5000]] as const) {
        await sleep(ms);
        const c2 = await client.calls(call.sid).fetch();
        timeline.push({ t, status: c2.status });
        if (c2.status === 'failed' || c2.status === 'completed' || c2.status === 'busy' || c2.status === 'no-answer') break;
      }
      // Any Debugger error generated for this call (e.g. 52134 push failure)?
      let callAlerts: unknown = [];
      try {
        const a = await client.monitor.v1.alerts.list({ limit: 8 });
        callAlerts = a
          .filter((x) => !x.resourceSid || x.resourceSid === call.sid)
          .map((x) => ({ code: x.errorCode, text: (x.alertText || '').slice(0, 200), resource: x.resourceSid }));
      } catch { /* non-fatal */ }
      ringTest = { sid: call.sid, to: `client:${identity}`, from, timeline, callAlerts };
    } catch (e) {
      ringTest = { error: (e as { message?: string })?.message?.slice(0, 200), code: (e as { code?: number })?.code ?? null };
    }
  }

  return NextResponse.json({ ok: true, valid, keyError, prefixes, twimlAppSidEnv: twimlAppSid ?? '(EMPTY)', keyFriendlyName, twimlApp, inbound, pushCred, sipDomains, alerts, calls, account, numbers, ringTest, callProbe, regionProbe });
}
