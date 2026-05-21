// Server-only helper: transcribes a WAV recording with OpenAI and generates
// a Greek CRM brief using the Responses API.
// No SDK required. Uses fetch directly.
// NEVER log the transcript or brief contents to avoid leaking caller data.

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const BRIEF_TIMEOUT_MS = 30_000;

export interface TranscribeAndBriefInput {
  audioFile: File;
  callerNumber: string | null;
  dialStatus: string | null;
  uniqueId: string | null;
  communicationSummary: string | null;
}

export interface TranscribeAndBriefResult {
  transcript: string;
  brief: string;
  transcriptionModel: string;
  briefModel: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Safely extract text from the OpenAI Responses API response shape.
// Prefers the top-level output_text convenience field if present.
// Falls back to traversing output[].content[].text.
function extractResponsesText(data: unknown): string | null {
  if (!isRecord(data)) return null;

  const outputText = data['output_text'];
  if (typeof outputText === 'string' && outputText.trim().length > 0) {
    return outputText.trim();
  }

  const output = data['output'];
  if (!Array.isArray(output)) return null;

  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = item['content'];
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (!isRecord(c)) continue;
      const text = c['text'];
      if (typeof text === 'string' && text.trim().length > 0) {
        parts.push(text.trim());
      }
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

function buildBriefPrompt(
  transcript: string,
  callerNumber: string | null,
  dialStatus: string | null
): string {
  const contextLines: string[] = [];
  if (callerNumber) contextLines.push(`Αριθμός καλούντος: ${callerNumber}`);
  if (dialStatus) contextLines.push(`Αποτέλεσμα κλήσης: ${dialStatus}`);

  const contextSection = contextLines.length > 0
    ? `Μεταδεδομένα κλήσης:\n${contextLines.join('\n')}\n\n`
    : '';

  return [
    'Είσαι βοηθός CRM για Έλληνα επαγγελματία.',
    'Παρακάτω υπάρχει η μεταγραφή τηλεφωνικής κλήσης.',
    'Χρησιμοποίησε ΤΗΝ ΜΕΤΑΓΡΑΦΗ ως βασική πηγή πληροφοριών.',
    'Αν η μεταγραφή είναι ασαφής ή ελλιπής, το αναφέρεις ρητά.',
    'Μην επινοείς δεδομένα που δεν υπάρχουν στη μεταγραφή.',
    'Γράψε σε επαγγελματικά ελληνικά, χωρίς JSON, χωρίς markdown.',
    'Ξεκίνα με: AI brief από ηχογράφηση:',
    '',
    'Συμπέριλαβε με τη σειρά:',
    '1. Τι ειπώθηκε - σύντομη περίληψη της κλήσης.',
    '2. Ανάγκη πελάτη - τι ζήτησε ή χρειάζεται ο πελάτης.',
    '3. Επόμενη ενέργεια - συγκεκριμένο επόμενο βήμα.',
    '4. Στοιχεία που λείπουν - τι δεν προέκυψε από τη μεταγραφή.',
    '',
    `${contextSection}Μεταγραφή:`,
    transcript,
  ].join('\n');
}

export async function transcribeAndBriefCallAudio(
  input: TranscribeAndBriefInput
): Promise<TranscribeAndBriefResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const transcriptionModel =
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-transcribe';
  const briefModel =
    process.env.OPENAI_BRIEF_MODEL?.trim() || 'gpt-4o';

  // ---------------------------------------------------------------------------
  // Step 1: Transcription
  // ---------------------------------------------------------------------------
  const transcriptionForm = new FormData();
  transcriptionForm.append('file', input.audioFile);
  transcriptionForm.append('model', transcriptionModel);
  transcriptionForm.append('language', 'el');
  transcriptionForm.append('response_format', 'json');

  const transcriptionController = new AbortController();
  const transcriptionTimer = setTimeout(
    () => transcriptionController.abort(),
    TRANSCRIPTION_TIMEOUT_MS
  );

  let transcript: string;
  try {
    const res = await fetch(OPENAI_TRANSCRIPTION_URL, {
      method: 'POST',
      signal: transcriptionController.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcriptionForm,
    });

    if (!res.ok) {
      console.error('openai-call-audio: transcription returned', res.status);
      return null;
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      console.error('openai-call-audio: failed to parse transcription response');
      return null;
    }

    if (!isRecord(data) || typeof data['text'] !== 'string' || !data['text'].trim()) {
      console.error('openai-call-audio: transcription response missing text field');
      return null;
    }

    transcript = data['text'].trim();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('openai-call-audio: transcription timed out');
    } else {
      console.error('openai-call-audio: transcription fetch error');
    }
    return null;
  } finally {
    clearTimeout(transcriptionTimer);
  }

  // ---------------------------------------------------------------------------
  // Step 2: Brief generation via Responses API
  // ---------------------------------------------------------------------------
  const briefPrompt = buildBriefPrompt(transcript, input.callerNumber, input.dialStatus);

  const briefController = new AbortController();
  const briefTimer = setTimeout(() => briefController.abort(), BRIEF_TIMEOUT_MS);

  let brief: string;
  try {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      signal: briefController.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: briefModel,
        input: briefPrompt,
      }),
    });

    if (!res.ok) {
      console.error('openai-call-audio: brief generation returned', res.status);
      return null;
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      console.error('openai-call-audio: failed to parse brief response');
      return null;
    }

    const text = extractResponsesText(data);
    if (!text) {
      console.error('openai-call-audio: brief response missing text content');
      return null;
    }

    brief = text.startsWith('AI brief') ? text : `AI brief από ηχογράφηση:\n${text}`;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('openai-call-audio: brief generation timed out');
    } else {
      console.error('openai-call-audio: brief fetch error');
    }
    return null;
  } finally {
    clearTimeout(briefTimer);
  }

  return { transcript, brief, transcriptionModel, briefModel };
}
