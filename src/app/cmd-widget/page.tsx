'use client';

// Auth-less voice-dictation widget loaded inside the native app's WebView (the AI
// assistant mic). Records on the phone via getUserMedia/MediaRecorder — served over
// HTTPS so it's a secure context (inline HTML in a WebView is not, so the mic would
// be blocked). The mic ring pulses with the live audio level. On stop it posts the
// clip back to native as { type:'cmd_audio', audio }; native sends it to
// /api/ai/transcribe and fills the command box. No auth here — native owns the session.

import { useEffect, useRef, useState } from 'react';

function pickMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  // Prefer mp4/AAC (iOS WebView can only record/play those); Chrome falls to webm.
  for (const t of ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* keep probing */ }
  }
  return '';
}

type State = 'idle' | 'recording' | 'denied' | 'unsupported';
const MAX_SECONDS = 60;

export default function CmdWidgetPage() {
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [sent, setSent] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cleanup() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { void audioCtxRef.current?.close(); } catch { /* ignore */ }
    streamRef.current = null; audioCtxRef.current = null; recRef.current = null;
    setLevel(0);
  }
  useEffect(() => () => cleanup(), []);

  function post(dataUrl: string) {
    const w = window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } };
    if (w.ReactNativeWebView) {
      try { w.ReactNativeWebView.postMessage(JSON.stringify({ type: 'cmd_audio', audio: dataUrl })); setSent(true); } catch { /* ignore */ }
    }
  }

  async function start() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const type = rec.mimeType || mime || 'audio/mp4';
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null;
        cleanup();
        setSeconds(0);
        setState('idle');
        if (!blob || blob.size === 0) return;
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === 'string') post(reader.result); };
        reader.readAsDataURL(blob);
      };
      recRef.current = rec;

      // Audio-reactive level: read the analyser RMS each frame → drives the ring.
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        const srcNode = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        srcNode.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / data.length);
          setLevel(Math.min(1, rms * 3));
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch { /* visual is best-effort */ }

      rec.start(1000);
      setState('recording');
      setSeconds(0);
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      stopTimerRef.current = setTimeout(() => stop(), MAX_SECONDS * 1000);
    } catch {
      cleanup();
      setState('denied');
    }
  }

  function stop() {
    const r = recRef.current;
    try { if (r && r.state !== 'inactive') r.stop(); else { cleanup(); setState('idle'); } } catch { cleanup(); setState('idle'); }
  }

  const recording = state === 'recording';
  const ringScale = 1 + level * 0.9;
  const ringOpacity = 0.18 + level * 0.5;

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-white px-6 py-10 dark:bg-[#0e1722]">
      {sent ? (
        <p className="text-center text-[15px] font-medium text-emerald-700 dark:text-emerald-300">✓ Έτοιμο — επιστροφή στην εφαρμογή…</p>
      ) : (
        <>
          <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            {recording ? 'Μίλα… πάτησε για να σταματήσεις' : 'Πάτησε το μικρόφωνο και μίλα'}
          </p>

          <div className="relative flex h-44 w-44 items-center justify-center">
            {/* audio-reactive ring */}
            <div
              className="absolute rounded-full bg-indigo-500"
              style={{
                height: 132, width: 132,
                transform: `scale(${recording ? ringScale : 1})`,
                opacity: recording ? ringOpacity : 0,
                transition: recording ? 'none' : 'opacity 200ms ease',
              }}
            />
            <button
              type="button"
              onClick={recording ? stop : start}
              aria-label={recording ? 'Στοπ' : 'Ηχογράφηση'}
              className={`relative flex h-28 w-28 items-center justify-center rounded-full text-white shadow-lg transition active:scale-95 ${recording ? 'bg-red-600' : 'bg-indigo-600'}`}
            >
              <svg className="h-12 w-12" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
                {recording ? (
                  <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
                )}
              </svg>
            </button>
          </div>

          <p className="h-5 text-sm font-medium text-zinc-600 dark:text-zinc-300">
            {recording ? `${seconds}s` : ''}
          </p>

          {state === 'denied' && (
            <p className="text-center text-xs text-amber-600">Δεν δόθηκε άδεια μικροφώνου. Ενεργοποίησέ την και δοκίμασε ξανά.</p>
          )}
          {state === 'unsupported' && (
            <p className="text-center text-xs text-amber-600">Η συσκευή δεν υποστηρίζει ηχογράφηση εδώ.</p>
          )}
        </>
      )}
    </main>
  );
}
