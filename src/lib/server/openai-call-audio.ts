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
  taskTitle: string;
  taskNote: string;
  taskType: 'call_back' | 'follow_up_offer';
  taskDueDate: string;
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
    ? `Μεταδεδομένα: ${contextLines.join(', ')}\n\n`
    : '';

  return [
    'Είσαι βοηθός CRM για Έλληνα επαγγελματία.',
    'Βασίσου ΑΠΟΚΛΕΙΣΤΙΚΑ στη μεταγραφή κλήσης παρακάτω.',
    'Μην επινοείς λεπτομέρειες που δεν υπάρχουν στη μεταγραφή.',
    'Γράψε πολύ σύντομο CRM brief σε επαγγελματικά ελληνικά, 2-3 γραμμές μόνο.',
    'Ξεκίνα με: AI brief από ηχογράφηση:',
    'Συμπέριλαβε μόνο: τι ζητά ο πελάτης, τυχόν συμφωνηθέν επόμενο βήμα, τι λείπει αν είναι σημαντικό.',
    'Χωρίς αριθμημένα βήματα, χωρίς τίτλους ενοτήτων, χωρίς μεταγραφή, χωρίς JSON.',
    '',
    `${contextSection}Μεταγραφή:`,
    transcript,
  ].join('\n');
}

function containsKeyword(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}

function getTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function deriveTask(
  transcript: string,
  brief: string
): { title: string; type: 'call_back' | 'follow_up_offer'; note: string; dueDate: string } {
  const combined = transcript + ' ' + brief;

  const isAppointment =
    containsKeyword(combined, 'ραντεβ') ||
    containsKeyword(combined, 'συνεργει');
  const isOffer = containsKeyword(combined, 'προσφορ');

  let title: string;
  let type: 'call_back' | 'follow_up_offer';

  if (isAppointment) {
    title = 'Επιβεβαίωση ραντεβού με πελάτη';
    type = 'call_back';
  } else if (isOffer) {
    title = 'Προετοιμασία προσφοράς για πελάτη';
    type = 'follow_up_offer';
  } else {
    title = 'Follow up με πελάτη';
    type = 'call_back';
  }

  const note = `Draft από AI μετά την κλήση. Να ελεγχθεί πριν από ενέργεια.\n${brief}`;
  return { title, type, note, dueDate: getTomorrow() };
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

  const task = deriveTask(transcript, brief);
  return {
    transcript,
    brief,
    transcriptionModel,
    briefModel,
    taskTitle: task.title,
    taskNote: task.note,
    taskType: task.type,
    taskDueDate: task.dueDate,
  };
}
