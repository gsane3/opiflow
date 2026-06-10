import { Call, Voice } from '@twilio/voice-react-native-sdk';

import { apiGet } from './api';

export type CallStatus = 'connecting' | 'ringing' | 'connected' | 'disconnected' | 'failed';

export interface ActiveCall {
  disconnect: () => void;
  mute: (on: boolean) => void;
}

const voice = new Voice();

async function fetchVoiceToken(onLog?: (s: string) => void): Promise<string> {
  const res = await apiGet<{ ok?: boolean; ready?: boolean; token?: string; error?: string }>(
    '/api/phone/twilio-token?platform=ios',
  );
  console.log('[twilio] token response:', JSON.stringify({ ok: res?.ok, ready: res?.ready, hasToken: !!res?.token, error: res?.error }));
  onLog?.(`token: ok=${res?.ok} hasToken=${!!res?.token} err=${res?.error ?? '-'}`);
  if (!res?.token) throw new Error(`Δεν λήφθηκε token (ok=${res?.ok}, err=${res?.error ?? 'none'}).`);
  return res.token;
}

/** Place an outgoing call through Twilio → TwiML App → Asterisk → InterTelecom. */
export async function placeCall(
  to: string,
  onStatus: (s: CallStatus) => void,
  onLog?: (s: string) => void,
): Promise<ActiveCall> {
  console.log('[twilio] placeCall →', to);
  onLog?.(`κλήση προς ${to}…`);
  const token = await fetchVoiceToken(onLog);
  onStatus('connecting');
  onLog?.('connecting (voice.connect)…');
  console.log('[twilio] voice.connect…');

  const call = await voice.connect(token, { params: { To: to } });
  console.log('[twilio] voice.connect returned a call object:', !!call);
  onLog?.('connect() επέστρεψε — αναμονή events…');

  call.on(Call.Event.Ringing, () => { console.log('[twilio] event: ringing'); onLog?.('event: ringing'); onStatus('ringing'); });
  call.on(Call.Event.Connected, () => { console.log('[twilio] event: connected'); onLog?.('event: connected'); onStatus('connected'); });
  call.on(Call.Event.Disconnected, (e?: unknown) => { console.log('[twilio] event: disconnected', e); onLog?.('event: disconnected'); onStatus('disconnected'); });
  call.on(Call.Event.ConnectFailure, (e?: unknown) => { console.log('[twilio] event: connectFailure', e); onLog?.(`event: connectFailure ${e ? JSON.stringify(e) : ''}`); onStatus('failed'); });

  return {
    disconnect: () => { void call.disconnect(); },
    mute: (on: boolean) => { void call.mute(on); },
  };
}

// ---- Incoming calls (VoIP push → CallKit) -------------------------------------

let listenersWired = false;
function wireIncomingListeners() {
  if (listenersWired) return;
  listenersWired = true;
  try {
    voice.on(Voice.Event.CallInvite, (invite: unknown) => {
      console.log('[twilio] >>> CallInvite (incoming) <<<', invite);
      // On iOS the SDK reports this to CallKit automatically (native incoming UI).
    });
    // @ts-expect-error preview enum may vary
    voice.on(Voice.Event.CancelledCallInvite, () => console.log('[twilio] CallInvite cancelled'));
    // @ts-expect-error preview enum may vary
    voice.on(Voice.Event.Registered, () => console.log('[twilio] >>> Registered for incoming <<<'));
    // @ts-expect-error preview enum may vary
    voice.on(Voice.Event.Unregistered, () => console.log('[twilio] Unregistered'));
    voice.on(Voice.Event.Error, (e: unknown) => console.log('[twilio] Voice error', e));
  } catch (e) {
    console.log('[twilio] wireIncomingListeners err', e);
  }
}

/** Register this device to RECEIVE incoming calls (binds the VoIP push token to Twilio). */
export async function registerForIncoming(onLog?: (s: string) => void): Promise<void> {
  try {
    wireIncomingListeners();
    // iOS: let the SDK own the PushKit registry so it can wake the app + report to CallKit.
    try {
      const v = voice as unknown as { initializePushRegistry?: () => Promise<void> };
      if (typeof v.initializePushRegistry === 'function') {
        await v.initializePushRegistry();
        console.log('[twilio] initializePushRegistry ok');
      }
    } catch (e) {
      console.log('[twilio] initializePushRegistry err', e);
    }
    const token = await fetchVoiceToken(onLog);
    await voice.register(token);
    console.log('[twilio] voice.register() called ok');
    onLog?.('register() ok');
  } catch (e) {
    console.log('[twilio] registerForIncoming failed', e);
    onLog?.('register failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}
