// Voice dictation for /cmd + /ai-review.
//
// This used to wrap the browser SpeechRecognition API — which is vendor-cloud
// (Chrome/Edge send audio to Google/Azure), frequently rejects el-GR on Edge
// («language-not-supported»), fails with a silent «network» error behind
// proxies, and simply doesn't exist on Firefox (the mic button was hidden).
// Replaced with the stack that already works everywhere in the product:
// getUserMedia + MediaRecorder (mp4-first probe, proven on iOS Safari by the
// /cmd-widget + DisclosureRecorder) → POST /api/ai/transcribe (OpenAI).

import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export function isDictationSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

// Prefer mp4/AAC (iOS Safari can only record those); Chrome falls to webm.
function pickDictationMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const t of [
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ]) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      // keep probing
    }
  }
  return '';
}

// Safety ceiling — dictated commands are sentences, not lectures, and the
// transcribe route caps payloads at 10MB anyway.
const MAX_DICTATION_MS = 90_000;

export interface DictationSession {
  /** Stop and deliver the recording via onBlob. */
  stop(): void;
  /** Stop and discard (unmount/cancel). */
  cancel(): void;
}

export async function startDictation(handlers: {
  onBlob: (blob: Blob) => void;
  onError: (kind: 'denied' | 'failed') => void;
}): Promise<DictationSession | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    handlers.onError('denied');
    return null;
  }

  let recorder: MediaRecorder;
  try {
    const mime = pickDictationMime();
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    handlers.onError('failed');
    return null;
  }

  const chunks: Blob[] = [];
  let cancelled = false;

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    clearTimeout(maxTimer);
    if (cancelled) return;
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
    if (blob.size > 0) handlers.onBlob(blob);
    else handlers.onError('failed');
  };

  const maxTimer = setTimeout(() => {
    try {
      if (recorder.state === 'recording') recorder.stop();
    } catch {
      // already stopped
    }
  }, MAX_DICTATION_MS);

  recorder.start();

  return {
    stop() {
      try {
        if (recorder.state === 'recording') recorder.stop();
      } catch {
        // already stopped
      }
    },
    cancel() {
      cancelled = true;
      try {
        if (recorder.state === 'recording') recorder.stop();
      } catch {
        // already stopped
      }
    },
  };
}

/** Blob → base64 data-URL → POST /api/ai/transcribe → recognized text. */
export async function transcribeAudioBlob(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
  if (!dataUrl.startsWith('data:audio/')) throw new Error('invalid_audio');

  const supabase = createBrowserSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch('/api/ai/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ audio: dataUrl }),
  });
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || typeof json.text !== 'string' || !json.text.trim()) {
    throw new Error(json.error ?? 'transcription_failed');
  }
  return json.text.trim();
}
