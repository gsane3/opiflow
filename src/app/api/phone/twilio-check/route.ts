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
  if (!accountSid || !apiKey || !apiSecret) {
    return NextResponse.json({ ok: false, error: 'missing_env', has });
  }

  const prefixes = {
    accountSid: accountSid.slice(0, 6) + '…' + accountSid.slice(-2),
    apiKey: apiKey.slice(0, 6) + '…' + apiKey.slice(-2),
  };

  try {
    const client = twilio(apiKey, apiSecret, { accountSid });
    // Fetching the key itself validates account+key+secret as a matching combo.
    const key = await client.keys(apiKey).fetch();

    let twimlApp: {
      sid?: string;
      ok: boolean;
      friendlyName?: string;
      voiceUrl?: string;
      voiceMethod?: string;
      code?: number | string | null;
    } = { ok: false };
    if (twimlAppSid) {
      try {
        const app = await client.applications(twimlAppSid).fetch();
        twimlApp = {
          sid: twimlAppSid,
          ok: true,
          friendlyName: app.friendlyName,
          voiceUrl: app.voiceUrl || '(EMPTY)',
          voiceMethod: app.voiceMethod || '(none)',
        };
      } catch (e) {
        twimlApp = { sid: twimlAppSid, ok: false, code: (e as { code?: number })?.code ?? 'fetch_failed' };
      }
    }

    return NextResponse.json({ ok: true, valid: true, prefixes, keyFriendlyName: key.friendlyName, twimlApp });
  } catch (e) {
    const err = e as { code?: number; status?: number; message?: string };
    return NextResponse.json({
      ok: true,
      valid: false,
      prefixes,
      code: err?.code ?? null,
      status: err?.status ?? null,
      message: err?.message?.slice(0, 200) ?? null,
    });
  }
}
