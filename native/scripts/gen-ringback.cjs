// One-off generator for assets/ringback.wav — the Greek/EU call-progress
// ringback tone played locally while an outbound call is ringing (the Twilio
// answerOnBridge ringback doesn't reach the SDK audio path). ETSI cadence:
// 425 Hz, 1 s ON / 4 s OFF, looped. 8 kHz mono 16-bit PCM (~78 KB).
//
// Run from native/:  node scripts/gen-ringback.cjs
const fs = require('fs');
const path = require('path');

const SR = 8000;
const FREQ = 425;
const TONE_SEC = 1.0;
const SILENCE_SEC = 4.0;
const total = Math.round(SR * (TONE_SEC + SILENCE_SEC));
const toneN = Math.round(SR * TONE_SEC);
const fade = Math.round(SR * 0.01); // 10 ms fade to avoid clicks

const data = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) {
  let s = 0;
  if (i < toneN) {
    let amp = 0.5;
    if (i < fade) amp *= i / fade;
    if (i > toneN - fade) amp *= (toneN - i) / fade;
    s = Math.sin((2 * Math.PI * FREQ * i) / SR) * amp;
  }
  const v = Math.max(-1, Math.min(1, s));
  data.writeInt16LE(Math.round(v * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(data.length, 40);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'ringback.wav');
fs.writeFileSync(out, Buffer.concat([header, data]));
console.log('wrote', out, 44 + data.length, 'bytes');
