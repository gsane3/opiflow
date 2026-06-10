import { Call, Voice } from '@twilio/voice-react-native-sdk';

import { apiGet } from './api';

export type CallStatus = 'connecting' | 'ringing' | 'connected' | 'disconnected' | 'failed';

export interface ActiveCall {
  disconnect: () => void;
  mute: (on: boolean) => void;
}

const voice = new Voice();

async function fetchVoiceToken(): Promise<string> {
  const res = await apiGet<{ ok?: boolean; token?: string }>('/api/phone/twilio-token?platform=ios');
  if (!res?.token) throw new Error('Δεν λήφθηκε token κλήσης.');
  return res.token;
}

/** Place an outgoing call through Twilio → TwiML App → Asterisk → InterTelecom. */
export async function placeCall(to: string, onStatus: (s: CallStatus) => void): Promise<ActiveCall> {
  const token = await fetchVoiceToken();
  onStatus('connecting');
  const call = await voice.connect(token, { params: { To: to } });

  call.on(Call.Event.Ringing, () => onStatus('ringing'));
  call.on(Call.Event.Connected, () => onStatus('connected'));
  call.on(Call.Event.Disconnected, () => onStatus('disconnected'));
  call.on(Call.Event.ConnectFailure, () => onStatus('failed'));

  return {
    disconnect: () => {
      void call.disconnect();
    },
    mute: (on: boolean) => {
      void call.mute(on);
    },
  };
}
