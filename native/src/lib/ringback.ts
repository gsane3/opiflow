// Local outbound-call ringback ("του-του").
//
// The Twilio TwiML dials with answerOnBridge=true, which is supposed to feed
// carrier ringback to the caller — but it doesn't reach the Voice SDK's audio
// path on the device, so the technician hears silence while the line rings.
// We play a looping Greek/EU ringback tone (assets/ringback.wav, 425 Hz, 1 s
// on / 4 s off) locally during 'connecting'/'ringing' and stop the moment the
// call connects or ends. Entirely best-effort: any failure is swallowed so it
// can never break call placement.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let player: AudioPlayer | null = null;

export async function startRingback(): Promise<void> {
  try {
    if (player) return; // already ringing
    // Audible even with the iOS silent switch on (a ringing call should be heard).
    await setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    const p = createAudioPlayer(require('../../assets/ringback.wav'));
    p.loop = true;
    p.volume = 1.0;
    p.play();
    player = p;
  } catch (e) {
    console.log('[ringback] start err', e);
  }
}

export function stopRingback(): void {
  const p = player;
  player = null;
  if (!p) return;
  try {
    p.pause();
    p.remove();
  } catch (e) {
    console.log('[ringback] stop err', e);
  }
}
