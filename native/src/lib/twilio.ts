// IMPORTANT: this module is loaded ONLY via dynamic import() (from the call/register
// handlers), never at startup — importing @twilio/voice-react-native-sdk runs a
// module-level `new NativeEventEmitter(nativeModule)` which crashes release builds
// if it happens before the native module is ready (i.e. at launch).
import { Call, Voice } from '@twilio/voice-react-native-sdk';

import { apiGet } from './api';
import { type ActiveCall, type CallStatus, setIncomingState } from './twilio-state';

let _voice: Voice | null = null;
function getVoice(): Voice {
  if (!_voice) _voice = new Voice();
  return _voice;
}

async function fetchVoiceToken(onLog?: (s: string) => void): Promise<string> {
  const res = await apiGet<{ ok?: boolean; token?: string; error?: string }>(
    '/api/phone/twilio-token?platform=ios',
  );
  onLog?.(`token: ok=${res?.ok} hasToken=${!!res?.token} err=${res?.error ?? '-'}`);
  if (!res?.token) throw new Error(`Δεν λήφθηκε token (ok=${res?.ok}, err=${res?.error ?? 'none'}).`);
  return res.token;
}

/** Place an outgoing call: app → Twilio → TwiML App → Asterisk → InterTelecom. */
export async function placeCall(
  to: string,
  onStatus: (s: CallStatus) => void,
  onLog?: (s: string) => void,
): Promise<ActiveCall> {
  onLog?.(`κλήση προς ${to}…`);
  const token = await fetchVoiceToken(onLog);
  onStatus('connecting');
  const voice = getVoice();
  const call = await voice.connect(token, { params: { To: to } });

  call.on(Call.Event.Ringing, () => { onLog?.('ringing'); onStatus('ringing'); });
  call.on(Call.Event.Connected, () => { onLog?.('connected'); onStatus('connected'); });
  call.on(Call.Event.Disconnected, () => { onLog?.('disconnected'); onStatus('disconnected'); });
  call.on(Call.Event.ConnectFailure, (e?: unknown) => { onLog?.(`connectFailure ${e ? JSON.stringify(e) : ''}`); onStatus('failed'); });

  return {
    disconnect: () => { void call.disconnect(); },
    mute: (on: boolean) => { void call.mute(on); },
  };
}

let listenersWired = false;
function wireIncomingListeners() {
  if (listenersWired) return;
  listenersWired = true;
  const voice = getVoice();
  try {
    voice.on(Voice.Event.CallInvite, (invite: unknown) => {
      console.log('[twilio] >>> CallInvite (incoming) <<<', invite);
    });
    voice.on(Voice.Event.Registered, () => console.log('[twilio] Registered event'));
    voice.on(Voice.Event.Error, (e: unknown) => {
      const msg = e instanceof Error ? e.message : e && typeof e === 'object' ? JSON.stringify(e) : String(e);
      console.log('[twilio] Voice error', msg);
      setIncomingState({ state: 'error', detail: 'VoiceError: ' + msg });
    });
  } catch (e) {
    console.log('[twilio] wireIncomingListeners err', e);
  }
}

/** Register this device to RECEIVE incoming calls (binds the VoIP push token). */
export async function registerForIncoming(onLog?: (s: string) => void): Promise<void> {
  setIncomingState({ state: 'registering' });
  try {
    const voice = getVoice();
    wireIncomingListeners();
    try {
      const v = voice as unknown as { initializePushRegistry?: () => Promise<void> };
      if (typeof v.initializePushRegistry === 'function') await v.initializePushRegistry();
    } catch (e) {
      console.log('[twilio] initializePushRegistry err', e);
    }
    const token = await fetchVoiceToken(onLog);
    await voice.register(token);
    // Diagnostic: surface the iOS VoIP device token length. A real APNs VoIP
    // token is 64 hex chars; "ΚΕΝΟ" (empty) would explain a Twilio <Client> 404.
    let dt = '';
    try {
      dt = await voice.getDeviceToken();
    } catch {
      dt = 'ERR';
    }
    const detail = dt === 'ERR' ? 'deviceToken=ERROR' : dt ? `deviceToken=${dt.length}χαρ` : 'deviceToken=ΚΕΝΟ';
    setIncomingState({ state: 'registered', detail });
    onLog?.('register() ok — ' + detail);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    setIncomingState({ state: 'error', detail });
    onLog?.('register failed: ' + detail);
  }
}
