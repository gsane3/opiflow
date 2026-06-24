// IMPORTANT: this module is loaded ONLY via dynamic import() (from the call/register
// handlers), never at startup — importing @twilio/voice-react-native-sdk runs a
// module-level `new NativeEventEmitter(nativeModule)` which crashes release builds
// if it happens before the native module is ready (i.e. at launch).
import { Call, CallInvite, Voice } from '@twilio/voice-react-native-sdk';
import { Platform } from 'react-native';

import { apiGet, apiPost } from './api';
import { resolveCallerName } from './caller-name';
import { type ActiveCall, type CallStatus, setIncomingState, setIncomingCall, getIncomingCall, setIncomingCallName } from './twilio-state';

// #10: resolve the caller's number to a name (Opiflow customer or device contact)
// and push it into the call-name store IF this is still the current call. Async +
// best-effort: the ring screen already shows the number instantly; this upgrades
// it to a name when resolved. Called for both the ringing and connected phases
// (resolveCallerName caches, so the second call is instant and re-shows the name
// after the connected session resets it).
function applyCallerName(from: string | null) {
  if (!from) return;
  void resolveCallerName(from).then((name) => {
    if (!name) return;
    const cur = getIncomingCall();
    if (cur && cur.from === from) setIncomingCallName(name);
  });
}

let _voice: Voice | null = null;
function getVoice(): Voice {
  if (!_voice) _voice = new Voice();
  return _voice;
}

async function fetchVoiceToken(onLog?: (s: string) => void): Promise<{ token: string; pushConfigured: boolean }> {
  // The platform decides which Push Credential the server embeds (APNs vs FCM)
  // — hardcoding ios left Android registrations bound to the wrong credential.
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  const res = await apiGet<{ ok?: boolean; token?: string; error?: string; pushConfigured?: boolean }>(
    `/api/phone/twilio-token?platform=${platform}`,
  );
  onLog?.(`token: ok=${res?.ok} hasToken=${!!res?.token} push=${res?.pushConfigured ? 'yes' : 'no'} err=${res?.error ?? '-'}`);
  if (!res?.token) throw new Error(`Δεν λήφθηκε token (ok=${res?.ok}, err=${res?.error ?? 'none'}).`);
  return { token: res.token, pushConfigured: res.pushConfigured === true };
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
  const { token } = await fetchVoiceToken(onLog);
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

// Best-effort caller extraction from an invite/call (number or URI user-part).
function inviteFrom(invite: CallInvite): string | null {
  try {
    const f = invite.getFrom();
    return typeof f === 'string' && f.trim() ? f.trim() : null;
  } catch {
    return null;
  }
}

// Log an answered INBOUND call to the CRM exactly once. The Twilio CallSid lets
// the recording webhook attach the transcript + AI brief to this row (parity
// with the outbound logCall in placeCall).
function logInboundCall(call: Call, from: string | null, status: 'completed' | 'failed') {
  const sid = (() => { try { return call.getSid(); } catch { return undefined; } })();
  apiPost('/api/calls/log', {
    direction: 'inbound',
    status,
    phone: from,
    ...(sid ? { providerCallId: sid } : {}),
  }).catch((e) => console.log('[twilio] inbound call log failed', e));
}

// Log an inbound call that rang but was never answered (cancelled / timed out /
// stale invite) so it shows in «Αναπάντητες». Mirrors the PBX 'missed' rows.
function logMissedInbound(from: string | null) {
  apiPost('/api/calls/log', { direction: 'inbound', status: 'missed', phone: from })
    .catch((e) => console.log('[twilio] missed call log failed', e));
}

// Wire a LIVE accepted Call into the incoming-call state so the in-app modal
// flips to its connected view (mute / hangup) and the result is logged once.
// Called from BOTH paths: our JS «Απάντηση» button AND a native CallKit /
// notification answer (the SDK emits CallInvite.Event.Accepted either way).
function wireConnectedCall(call: Call, from: string | null) {
  let logged = false;
  const doLog = (status: 'completed' | 'failed') => {
    if (logged) return;
    logged = true;
    logInboundCall(call, from, status);
  };

  setIncomingCall({
    phase: 'connected',
    from,
    accept: () => { /* already connected */ },
    reject: () => { try { void call.disconnect(); } catch { /* ignore */ } },
    disconnect: () => { try { void call.disconnect(); } catch { /* ignore */ } },
    mute: (on: boolean) => { try { void call.mute(on); } catch { /* ignore */ } },
  });
  applyCallerName(from); // keep the resolved name showing during the call

  call.on(Call.Event.Disconnected, () => { doLog('completed'); setIncomingCall(null); });
  call.on(Call.Event.ConnectFailure, () => { doLog('failed'); setIncomingCall(null); });
}

// Ring window: server <Dial timeout=30> + grace. A ringing invite still showing
// after this is treated as missed — covers the "opened the app, it showed a dead
// ringing call" case (the Cancelled event never reached us because we were
// killed during the ring).
const RING_TIMEOUT_MS = 35_000;

let listenersWired = false;
function wireIncomingListeners() {
  if (listenersWired) return;
  listenersWired = true;
  const voice = getVoice();
  try {
    voice.on(Voice.Event.CallInvite, (invite: CallInvite) => {
      const from = inviteFrom(invite);
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = () => {
        settled = true;
        if (timer) { clearTimeout(timer); timer = null; }
      };

      // Identity-checked clear: only dismiss the modal if THIS invite is still
      // the one showing (a newer invite must not be wiped by an old timer).
      // `if (settled) return` makes accept/reject/disconnect idempotent so a
      // rapid double-tap can't accept/reject twice (duplicate logs/sessions).
      const session = {
        phase: 'ringing' as const,
        from,
        // Just trigger accept; the connected UI is wired by the Accepted event
        // below (which ALSO fires for a native CallKit answer).
        accept: () => { if (settled) return; settle(); try { void invite.accept(); } catch { logMissedInbound(from); clearIfCurrent(); } },
        reject: () => { if (settled) return; settle(); try { void invite.reject(); } catch { /* ignore */ } finally { clearIfCurrent(); } },
        disconnect: () => { if (settled) return; settle(); try { void invite.reject(); } catch { /* ignore */ } finally { clearIfCurrent(); } },
        mute: () => { /* not muteable while ringing */ },
      };
      const clearIfCurrent = () => { if (getIncomingCall() === session) setIncomingCall(null); };

      setIncomingCall(session);
      applyCallerName(from); // #10: upgrade the ring screen from number → name when resolved

      // Answered — by our «Απάντηση» button OR the native iOS CallKit banner /
      // Android notification (the SDK emits this with the live Call either way).
      // This is what gives the in-app mute/hangup controls when the user taps the
      // native call banner (previously they were dumped into the app with none).
      invite.on(CallInvite.Event.Accepted, (call: Call) => {
        settle();
        wireConnectedCall(call, from);
      });

      // Caller hung up / server cancelled before we answered → log missed + clear.
      invite.on(CallInvite.Event.Cancelled, () => {
        if (settled) { clearIfCurrent(); return; }
        settle();
        logMissedInbound(from);
        clearIfCurrent();
      });

      // Safety net for a stale invite (Cancelled never arrived because we were
      // killed during the ring): auto-dismiss + log missed after the ring window.
      timer = setTimeout(() => {
        if (settled) return;
        settle();
        try { void invite.reject(); } catch { /* ignore */ }
        logMissedInbound(from);
        clearIfCurrent();
      }, RING_TIMEOUT_MS);
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

// CRITICAL for KILLED-APP incoming calls (iOS PushKit). The Twilio SDK creates
// its PKPushRegistry ONLY when JS calls initializePushRegistry() — it is NOT set
// up in the native module's init(). So when iOS relaunches a killed app for a
// VoIP push, the registry (and thus the lock-screen CallKit ring) only appears
// once this has run. It MUST therefore run as early as possible at launch and
// INDEPENDENTLY of login — otherwise the push is delivered late and the call
// only surfaces as a stale "ringing" when the user opens the app. Instantiating
// the module here also runs its init() (CallKit + notification observers).
// Idempotent: only the first call creates the registry.
let pushRegistryInited = false;
export async function initPushRegistry(onLog?: (s: string) => void): Promise<void> {
  if (pushRegistryInited) return;
  pushRegistryInited = true;
  try {
    const voice = getVoice();
    wireIncomingListeners();
    const v = voice as unknown as { initializePushRegistry?: () => Promise<void> };
    if (typeof v.initializePushRegistry === 'function') await v.initializePushRegistry();
    onLog?.('push registry initialized');
  } catch (e) {
    pushRegistryInited = false; // allow a retry on the next launch/foreground
    console.log('[twilio] initPushRegistry err', e);
  }
}

/**
 * Register this device to RECEIVE incoming calls (binds the VoIP push token).
 * Retries with backoff (cold launches often race the network coming up); never
 * throws — the outcome lands in twilio-state for the Home banner / Settings row.
 */
export async function registerForIncoming(onLog?: (s: string) => void): Promise<void> {
  setIncomingState({ state: 'registering' });
  const voice = getVoice();
  wireIncomingListeners();
  // Ensure the PushKit registry exists before binding the token (idempotent).
  await initPushRegistry(onLog);

  let lastDetail = '';
  for (const delay of REGISTER_RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const { token, pushConfigured } = await fetchVoiceToken(onLog);
      await voice.register(token);
      // pushConfigured=false → registered, but a killed app won't ring (no push
      // credential for this platform). Surfaced as a warning in Home/Settings.
      setIncomingState({ state: 'registered', pushConfigured });
      onLog?.('register() ok' + (pushConfigured ? '' : ' (no push credential — closed-app calls will NOT ring)'));
      return;
    } catch (e) {
      lastDetail = e instanceof Error ? e.message : String(e);
      onLog?.('register attempt failed: ' + lastDetail);
    }
  }
  setIncomingState({ state: 'error', detail: lastDetail });
  onLog?.('register failed: ' + lastDetail);
}
