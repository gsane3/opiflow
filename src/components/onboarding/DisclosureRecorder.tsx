'use client';

// Records the per-business call-recording DISCLOSURE clip in the user's own voice
// ("καραόκε": they read the on-screen line). Controlled component — `value` is a
// base64 data: URL ('' = none), `onChange` fires with the new clip (or '' to clear).
// Used in the onboarding wizard and in Settings → Τηλεφωνία. Web-only (MediaRecorder);
// native defers to web. Fully guarded: any mic/permission failure shows a message and
// never throws.

import { useEffect, useRef, useState } from 'react';

// The line the user reads aloud. Kept short + legally clear (Greece N.3471/2006 + GDPR).
export const DISCLOSURE_SCRIPT =
  'Καλησπέρα σας. Η κλήση ηχογραφείται για λόγους ποιότητας και καλύτερης εξυπηρέτησης.';

const MAX_SECONDS = 20;

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'];
  let probe: HTMLAudioElement | null = null;
  try { if (typeof document !== 'undefined') probe = document.createElement('audio'); } catch { /* no probe */ }
  const canPlay = (t: string): boolean => {
    if (!probe) return true; // can't probe → don't block selection
    try { return probe.canPlayType(t.split(';')[0].trim()) !== ''; } catch { return true; }
  };
  // Pick a type the browser can BOTH record (isTypeSupported) AND play (canPlayType),
  // so the preview actually plays. CRITICAL: iOS WKWebView/Safari can RECORD webm/opus
  // but CANNOT play it back (the «Error» preview); requiring canPlayType makes iOS skip
  // webm and choose mp4/aac, while Chrome/Firefox/Brave keep webm/opus. (Plain mp4-first
  // is wrong too: desktop Chrome reports mp4 supported but has no audio muxer → empty.)
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t) && canPlay(t)) return t; } catch { /* keep probing */ }
  }
  // Fallback: any recordable type (preview may not play, but it still saves and the
  // PBX transcodes it via ffmpeg regardless of container).
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* keep probing */ }
  }
  return '';
}

type MicState = 'idle' | 'recording' | 'denied' | 'unsupported' | 'noaudio';

export default function DisclosureRecorder({
  value,
  onChange,
  saving = false,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  saving?: boolean;
}) {
  const [mic, setMic] = useState<MicState>('idle');
  const [seconds, setSeconds] = useState(0);
  // Preview source: a base64 data: URL (esp. fragmented-mp4 from iOS MediaRecorder)
  // is flaky/non-seekable in <audio> on WebKit, so derive an object URL from `value`
  // for reliable playback. `value` itself stays the saved data URL.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Visible capture diagnostics (mic tracks / mime / chunks / size) — so a failing
  // capture is observable instead of a silent empty clip.
  const [diag, setDiag] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  function cleanup() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
    recorderRef.current = null;
  }

  // Stop recording / release the mic if the component unmounts mid-capture.
  useEffect(() => () => cleanup(), []);

  // The preview object URL is created straight from the recorded blob (in onstop) —
  // reliable in <audio> on Chrome AND iOS, unlike a webm/mp4 data: URL on WebKit.
  // Clear it when the saved clip is removed externally; revoke on unmount.
  useEffect(() => {
    if (!value && previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
    }
  }, [value]);
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  async function startRecording() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMic('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const atracks = stream.getAudioTracks();
      const at = atracks[0];
      const mimeType = pickAudioMimeType();
      setDiag(`mic: ${atracks.length} track(s)${at ? ` · enabled=${at.enabled} muted=${at.muted} "${at.label || '—'}"` : ''} · mime=${mimeType || '(default)'}`);
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        // Use the recorder's actual mime; default to mp4 (iOS-playable), never webm.
        const type = recorder.mimeType || mimeType || 'audio/mp4';
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null;
        cleanup();
        setSeconds(0);
        setDiag(`result: mime=${recorder.mimeType || mimeType || '?'} · chunks=${chunksRef.current.length} · ${blob ? Math.round(blob.size / 1024) + ' KB' : '0 B (empty!)'}`);
        if (!blob || blob.size === 0) {
          // Capture failed silently (e.g. codec/permission hiccup) — tell the user
          // instead of pretending it worked.
          setMic('noaudio');
          return;
        }
        setMic('idle');
        // Preview straight from the recorded blob (objectURL) — plays reliably in
        // <audio> on Chrome AND iOS, unlike a base64 data: URL on WebKit.
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(blob);
        setPreviewUrl(previewUrlRef.current);
        // `value` (data URL) is still produced for SAVING to the server.
        const reader = new FileReader();
        reader.onload = () => { if (typeof reader.result === 'string') onChange(reader.result); };
        reader.readAsDataURL(blob);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      // timeslice so ondataavailable fires during recording (more robust than
      // waiting for stop, esp. on Safari/iOS where a stop-only flush can be empty).
      recorder.start(1000);
      setMic('recording');
      setSeconds(0);
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      stopTimerRef.current = setTimeout(() => stopRecording(), MAX_SECONDS * 1000);
    } catch {
      cleanup();
      setMic('denied');
    }
  }

  function stopRecording() {
    const r = recorderRef.current;
    try { if (r && r.state !== 'inactive') r.stop(); else { cleanup(); setMic('idle'); } } catch { cleanup(); setMic('idle'); }
  }

  const hasClip = !!value;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Ηχογράφησε με τη <b>δική σου φωνή</b> το μήνυμα που θα ακούει ο πελάτης πριν μιλήσετε. Διάβασε
        καθαρά την παρακάτω φράση:
      </p>

      {/* The karaoke line */}
      <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 px-4 py-3 text-[15px] font-medium leading-relaxed text-indigo-900 dark:text-indigo-200 ring-1 ring-indigo-100 dark:ring-indigo-500/20">
        «{DISCLOSURE_SCRIPT}»
      </div>

      {/* Recorder */}
      {mic === 'recording' ? (
        <button
          type="button"
          onClick={stopRecording}
          className="flex items-center justify-center gap-2 rounded-2xl bg-red-600 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-red-700"
        >
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
          Στοπ ({seconds}s) — μιλάει το μικρόφωνο
        </button>
      ) : hasClip ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/15 dark:bg-[#1e2b38]">
          <audio key={previewUrl ?? value} src={previewUrl ?? value} controls className="w-full" />
          <div className="flex gap-3">
            <button type="button" onClick={startRecording} disabled={saving} className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50">
              Ηχογράφηση ξανά
            </button>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <button type="button" onClick={() => onChange('')} disabled={saving} className="text-sm text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200">
              Αφαίρεση
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startRecording}
          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-200 bg-zinc-50 px-4 py-3.5 text-sm font-semibold text-zinc-700 transition hover:border-indigo-300 hover:bg-indigo-50 dark:border-white/15 dark:bg-[#1e2b38] dark:text-zinc-200 dark:hover:bg-indigo-500/10"
        >
          <svg className="h-5 w-5 text-indigo-600" fill="none" strokeWidth={1.7} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z" />
          </svg>
          Ξεκίνα ηχογράφηση
        </button>
      )}

      {mic === 'denied' && (
        <p className="text-xs text-amber-600">Δεν δόθηκε άδεια μικροφώνου. Ενεργοποίησέ την από τον browser και δοκίμασε ξανά.</p>
      )}
      {mic === 'noaudio' && (
        <p className="text-xs text-amber-600">Δεν καταγράφηκε ήχος. Έλεγξε την άδεια μικροφώνου και δοκίμασε ξανά.</p>
      )}
      {mic === 'unsupported' && (
        <p className="text-xs text-amber-600">Ο browser δεν υποστηρίζει ηχογράφηση εδώ. Δοκίμασε από υπολογιστή (Chrome/Safari).</p>
      )}
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        Προαιρετικό. Αν δεν ηχογραφήσεις, παίζει ένα τυποποιημένο μήνυμα ώστε να παραμένεις νόμιμος. Μέγιστο {MAX_SECONDS} δευτερόλεπτα.
      </p>
      {diag ? (
        <p className="select-all rounded-lg bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          🛈 {diag}
        </p>
      ) : null}
    </div>
  );
}
