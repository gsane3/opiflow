// IMPORTANT: this module is loaded ONLY via dynamic import() (from the call/register
// handlers), never at startup — importing @twilio/voice-react-native-sdk runs a
// module-level `new NativeEventEmitter(nativeModule)` which crashes release builds
// if it happens before the native module is ready (i.e. at launch).
import { Call, Voice } from '@twilio/voice-react-native-sdk';
import { Platform } from 'react-native';

import { apiGet, apiPost } from './api';
import { type ActiveCall, type CallStatus, setIncomingState } from './twilio-state';

let _voice: Voice | null = null;
function getVoice(): Voice {
  if (!_voice) _voice = new Voice();
  return _voice;
}

async function fetchVoiceToken(onLog?: (s: string) => void): Promise<string> {
  // The platform decides which Push Credential the server embeds (APNs vs FCM)
  // — hardcoding ios left Android registrations bound to the wrong credential.
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const res = await apiGet<{ ok?: boolean; token?: string; error?: string }>(
    `/api/phone/twilio-token?platform=${platform}`,
  );
  onLog?.(`token: ok=${res?.ok} hasToken=${!!res?.token} err=${res?.error ?? '-'}`);
  if (!res?.token) throw new Error(`Δεν λήφθηκε token (ok=${res?.ok}, err=${res?.error ?? 'none'}).`);
  return res.token;
}

/** Outcome of the post-hangup CRM call-log, surfaced so the UI can open the
 *  post-call card and poll for the AI brief on the right communication row. */
export interface CallLogResult {
  communicationId?: string;
  status: 'completed' | 'failed';
}

/** Place an outgoing call: app → Twilio → TwiML App → Asterisk → InterTelecom. */
export async function placeCall(
  to: string,
  onStatus: (s: CallStatus) => void,
  onLog?: (s: string) => void,
  onLogged?: (r: CallLogResult) => void,
): Promise<ActiveCall> {
  onLog?.(`κλήση προς ${to}…`);
  const token = await fetchVoiceToken(onLog);
  onStatus('connecting');
  const voice = getVoice();
  const call = await voice.connect(token, { params: { To: to } });

  // Log the call to the CRM exactly once when it ends. The Twilio CallSid lets
  // the recording webhook attach the Deepgram transcript + AI brief to this row.
  // The /api/calls/log response carries the communicationId — surface it via
  // onLogged so the calls screen can open the post-call card + poll for the brief.
  let connected = false;
  let logged = false;
  const logCall = (status: 'completed' | 'failed') => {
    if (logged) return;
    logged = true;
    const sid = (() => { try { return call.getSid(); } catch { return undefined; } })();
    apiPost<{ communicationId?: string }>('/api/calls/log', {
      direction: 'outbound',
      status,
      phone: to,
      ...(sid ? { providerCallId: sid } : {}),
    })
      .then((r) => onLogged?.({ communicationId: r?.communicationId, status }))
      .catch((e) => {
        console.log('[twilio] call log failed', e);
        onLogged?.({ status });
      });
  };

  call.on(Call.Event.Ringing, () => { onLog?.('ringing'); onStatus('ringing'); });
  call.on(Call.Event.Connected, () => { connected = true; onLog?.('connected'); onStatus('connected'); });
  call.on(Call.Event.Disconnected, () => { onLog?.('disconnected'); onStatus('disconnected'); logCall(connected ? 'completed' : 'failed'); });
  call.on(Call.Event.ConnectFailure, (e?: unknown) => { onLog?.(`connectFailure ${e ? JSON.stringify(e) : ''}`); onStatus('failed'); logCall('failed'); });

  return {
    disconnect: () => { void call.disconnect(); },
    mute: (on: boolean) => { void call.mute(on); },
    sendDigits: (digits: string) => {
      try {
        void call.sendDigits(digits);
      } catch (e) {
        console.log('[twilio] sendDigits err', e);
      }
    },
    setSpeaker: (on: boolean) => {
      void (async () => {
        try {
          // Feature-detected: route audio to the speaker (or back to the
          // earpiece) via the SDK's audio-device API.
          const v = voice as unknown as {
            getAudioDevices?: () => Promise<{
              audioDevices: Array<{ type?: string; name?: string; select: () => Promise<void> }>;
            }>;
          };
          if (typeof v.getAudioDevices !== 'function') return;
          const { audioDevices } = await v.getAudioDevices();
          const want = on ? 'speaker' : 'earpiece';
          const dev = audioDevices.find((d) =>
            `${d.type ?? ''} ${d.name ?? ''}`.toLowerCase().includes(want),
          );
          if (dev) await dev.select();
        } catch (e) {
          console.log('[twilio] setSpeaker err', e);
        }
      })();
    },
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

const REGISTER_RETRY_DELAYS_MS = [0, 2_000, 6_000];

/**
 * Register this device to RECEIVE incoming calls (binds the VoIP push token).
 * Retries with backoff (cold launches often race the network coming up); never
 * throws — the outcome lands in twilio-state for the Home banner / Settings row.
 */
export async function registerForIncoming(onLog?: (s: string) => void): Promise<void> {
  setIncomingState({ state: 'registering' });
  const voice = getVoice();
  wireIncomingListeners();
  try {
    const v = voice as unknown as { initializePushRegistry?: () => Promise<void> };
    if (typeof v.initializePushRegistry === 'function') await v.initializePushRegistry();
  } catch (e) {
    console.log('[twilio] initializePushRegistry err', e);
  }

  let lastDetail = '';
  for (const delay of REGISTER_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const token = await fetchVoiceToken(onLog);
      await voice.register(token);
      setIncomingState({ state: 'registered' });
      onLog?.('register() ok');
      return;
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e);
      onLog?.('register attempt failed: ' + lastDetail);
    }
  }
  setIncomingState({ state: 'error', detail: lastDetail });
  onLog?.('register failed: ' + lastDetail);
}
