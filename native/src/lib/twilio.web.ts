// Web stub — the Twilio native module isn't available in the browser preview.
// Metro picks this over twilio.ts when bundling for web.

export type CallStatus = 'connecting' | 'ringing' | 'connected' | 'disconnected' | 'failed';

export interface ActiveCall {
  disconnect: () => void;
  mute: (on: boolean) => void;
}

export async function placeCall(): Promise<ActiveCall> {
  throw new Error('Οι κλήσεις είναι διαθέσιμες μόνο στην εφαρμογή (όχι στο web preview).');
}

export async function registerForIncoming(): Promise<void> {
  // no-op on web
}
