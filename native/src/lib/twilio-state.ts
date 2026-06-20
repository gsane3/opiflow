// Types + incoming-registration state — NO @twilio/... import here, so route files
// (which expo-router requires at startup) can use these WITHOUT loading the native
// Twilio SDK at launch (which crashes release builds: the native module isn't ready
// yet, so `new NativeEventEmitter(null)` throws). The SDK lives in twilio.ts and is
// loaded ONLY via dynamic import() when the user actually places a call / registers.

export type CallStatus = 'connecting' | 'ringing' | 'connected' | 'disconnected' | 'failed';

export interface ActiveCall {
  disconnect: () => void;
  mute: (on: boolean) => void;
  /** DTMF digits for IVRs («πατήστε 1 για...»). */
  sendDigits: (digits: string) => void;
  /** Route audio to the speakerphone (dirty-hands mode on a job site). */
  setSpeaker: (on: boolean) => void;
}

export type IncomingState = 'idle' | 'registering' | 'registered' | 'error';

// `pushConfigured`: did the last token carry a Push Credential for THIS platform?
// When false, the device registers but a killed/backgrounded app will NOT ring
// (Twilio fires no VoIP/FCM push). Surfaced as a warning in Home/Settings.
let incomingState: { state: IncomingState; detail?: string; pushConfigured?: boolean } = { state: 'idle' };

type Listener = () => void;
const listeners = new Set<Listener>();

export function getIncomingState() {
  return incomingState;
}

export function setIncomingState(next: { state: IncomingState; detail?: string; pushConfigured?: boolean }) {
  incomingState = next;
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // a broken listener must not break state updates
    }
  }
}

/** Subscribe to registration-state changes (Home banner, Settings row). */
export function subscribeIncomingState(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Incoming-call session (B7) — drives the global ring/in-call modal. Held here
// (no SDK import) so the modal + AppShell can read it without pulling the Twilio
// native module into the launch graph. twilio.ts populates it from the SDK's
// CallInvite / Call events.
// ---------------------------------------------------------------------------

export type IncomingPhase = 'ringing' | 'connected';

export interface IncomingCallSession {
  phase: IncomingPhase;
  /** Caller number/URI user-part, if the invite exposed it. */
  from: string | null;
  /** Answer the ringing call (no-op once connected). */
  accept: () => void;
  /** Decline a ringing call. */
  reject: () => void;
  /** Hang up a connected call. */
  disconnect: () => void;
  /** Mute/unmute the local mic (connected only). */
  mute: (on: boolean) => void;
}

let incomingCall: IncomingCallSession | null = null;
const callListeners = new Set<Listener>();

export function getIncomingCall(): IncomingCallSession | null {
  return incomingCall;
}

export function setIncomingCall(next: IncomingCallSession | null) {
  incomingCall = next;
  for (const fn of callListeners) {
    try {
      fn();
    } catch {
      // a broken listener must not break state updates
    }
  }
}

/** Subscribe to incoming-call changes (the global ring/in-call modal). */
export function subscribeIncomingCall(fn: Listener): () => void {
  callListeners.add(fn);
  return () => {
    callListeners.delete(fn);
  };
}
