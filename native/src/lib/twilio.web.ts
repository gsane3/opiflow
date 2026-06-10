// Web stub — the Twilio native module isn't available in the browser preview.
// Metro picks this over twilio.ts when bundling for web.
import { type ActiveCall, type CallStatus, setIncomingState } from './twilio-state';

export async function placeCall(
  _to: string,
  _onStatus: (s: CallStatus) => void,
  _onLog?: (s: string) => void,
): Promise<ActiveCall> {
  throw new Error('Οι κλήσεις είναι διαθέσιμες μόνο στην εφαρμογή (όχι στο web preview).');
}

export async function registerForIncoming(): Promise<void> {
  setIncomingState({ state: 'idle' });
}
