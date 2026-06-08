'use client';

// Native Twilio Voice adapter (Capacitor plugin bridge).
//
// Wraps @capgo/capacitor-twilio-voice. The plugin is DYNAMICALLY imported and
// every entry point is guarded by Capacitor.isNativePlatform(), so this module
// is a complete no-op on the web and the plugin never enters the web bundle —
// the same pattern as src/lib/native/push.ts.
//
// On native the device registers with a Twilio Voice access token minted by
// GET /api/phone/twilio-token (identity biz_<id>), then can place/receive calls
// that route through Twilio ↔ our Asterisk ↔ InterTelecom (Greek caller-ID).

import { createBrowserSupabaseClient } from '@/lib/supabase/client';

type VoicePlugin = (typeof import('@capgo/capacitor-twilio-voice'))['CapacitorTwilioVoice'];

let cached: VoicePlugin | null = null;

async function getPlugin(): Promise<VoicePlugin | null> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor?.isNativePlatform?.()) return null;
  } catch {
    return null;
  }
  if (cached) return cached;
  try {
    const mod = await import('@capgo/capacitor-twilio-voice');
    cached = mod.CapacitorTwilioVoice;
    return cached;
  } catch {
    return null;
  }
}

export async function isNativeVoiceAvailable(): Promise<boolean> {
  return (await getPlugin()) !== null;
}

async function fetchTwilioToken(): Promise<string | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const res = await fetch('/api/phone/twilio-token', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = (await res.json()) as { ready?: boolean; token?: string };
    return json?.ready && json?.token ? json.token : null;
  } catch {
    return null;
  }
}

export interface NativeVoiceCallbacks {
  onRegistered?: () => void;
  onRegistrationFailed?: (error: string) => void;
  onIncoming?: (data: { callSid: string; from: string }) => void;
  onConnected?: (data: { callSid: string }) => void;
  onDisconnected?: (data: { callSid: string; error?: string }) => void;
  onRinging?: (data: { callSid: string }) => void;
}

/**
 * Register the device with Twilio Voice (native only). Returns false on web,
 * when the token isn't ready (Twilio not configured), or on any failure.
 */
export async function initNativeVoice(cb: NativeVoiceCallbacks = {}): Promise<boolean> {
  const p = await getPlugin();
  if (!p) return false;
  const token = await fetchTwilioToken();
  if (!token) return false;

  try {
    await p.removeAllListeners();
    if (cb.onRegistered) await p.addListener('registrationSuccess', cb.onRegistered);
    if (cb.onRegistrationFailed) {
      await p.addListener('registrationFailure', (d) => cb.onRegistrationFailed!(d.error));
    }
    if (cb.onIncoming) {
      await p.addListener('callInviteReceived', (d) => cb.onIncoming!({ callSid: d.callSid, from: d.from }));
    }
    if (cb.onConnected) await p.addListener('callConnected', cb.onConnected);
    if (cb.onDisconnected) await p.addListener('callDisconnected', cb.onDisconnected);
    if (cb.onRinging) await p.addListener('callRinging', cb.onRinging);

    try { await p.requestMicrophonePermission(); } catch { /* prompt may already be handled */ }

    const res = await p.login({ accessToken: token });
    return Boolean(res?.success);
  } catch {
    return false;
  }
}

/** Place an outbound call to an E.164 number. */
export async function placeNativeCall(to: string): Promise<{ ok: boolean; callSid?: string }> {
  const p = await getPlugin();
  if (!p) return { ok: false };
  try {
    const r = await p.makeCall({ to });
    return { ok: Boolean(r?.success), callSid: r?.callSid };
  } catch {
    return { ok: false };
  }
}

export async function acceptNativeCall(callSid: string): Promise<void> {
  const p = await getPlugin();
  try { await p?.acceptCall({ callSid }); } catch { /* ignore */ }
}

export async function endNativeCall(callSid?: string): Promise<void> {
  const p = await getPlugin();
  try { await p?.endCall({ callSid }); } catch { /* ignore */ }
}

export async function muteNativeCall(muted: boolean): Promise<void> {
  const p = await getPlugin();
  try { await p?.muteCall({ muted }); } catch { /* ignore */ }
}

export async function setNativeSpeaker(enabled: boolean): Promise<void> {
  const p = await getPlugin();
  try { await p?.setSpeaker({ enabled }); } catch { /* ignore */ }
}
