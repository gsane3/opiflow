// Types + incoming-registration state — NO @twilio/... import here, so route files
// (which expo-router requires at startup) can use these WITHOUT loading the native
// Twilio SDK at launch (which crashes release builds: the native module isn't ready
// yet, so `new NativeEventEmitter(null)` throws). The SDK lives in twilio.ts and is
// loaded ONLY via dynamic import() when the user actually places a call / registers.

export type CallStatus = 'connecting' | 'ringing' | 'connected' | 'disconnected' | 'failed';

export interface ActiveCall {
  disconnect: () => void;
  mute: (on: boolean) => void;
}

export type IncomingState = 'idle' | 'registering' | 'registered' | 'error';

let incomingState: { state: IncomingState; detail?: string } = { state: 'idle' };

export function getIncomingState() {
  return incomingState;
}

export function setIncomingState(next: { state: IncomingState; detail?: string }) {
  incomingState = next;
}
