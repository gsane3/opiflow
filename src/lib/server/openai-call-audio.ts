// Server-only helper: transcribes a WAV recording with OpenAI and generates
// a Greek CRM brief using the Responses API.
// No SDK required. Uses fetch directly.
// NEVER log the transcript or brief contents to avoid leaking caller data.

const OPENAI_TRANSCRIPTION_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
// Deepgram diarization path (optional, env-gated via DEEPGRAM_API_KEY).
const DEEPGRAM_LISTEN_URL =
  'https://api.deepgram.com/v1/listen?model=nova-2&language=el&diarize=true&punctuate=true&smart_format=true';
const DEEPGRAM_MODEL_LABEL = 'deepgram-nova-2';
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

// ---------------------------------------------------------------------------
// Deepgram diarization (optional). Returns a speaker-labeled Greek transcript,
// e.g. "Ομιλητής 1: ...\nΟμιλητής 2: ...", or null on any failure so the
// caller can fall back to the existing OpenAI transcription path.
// ---------------------------------------------------------------------------

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  speaker?: number;
}

// Pull the words[] array out of the Deepgram response, regardless of whether
// diarized words live on the alternative directly or under paragraphs.
function extractDeepgramWords(data: unknown): DeepgramWord[] {
  if (!isRecord(data)) return [];
  const results = data['results'];
  if (!isRecord(results)) return [];
  const channels = results['channels'];
  if (!Array.isArray(channels) || channels.length === 0) return [];
  const channel = channels[0];
  if (!isRecord(channel)) return [];
  const alternatives = channel['alternatives'];
  if (!Array.isArray(alternatives) || alternatives.length === 0) return [];
  const alt = alternatives[0];
  if (!isRecord(alt)) return [];

  const rawWords = alt['words'];
  if (!Array.isArray(rawWords)) return [];

  const words: DeepgramWord[] = [];
  for (const w of rawWords) {
    if (!isRecord(w)) continue;
    const word = w['word'];
    if (typeof word !== 'string') continue;
    const punctuated = w['punctuated_word'];
    const speaker = w['speaker'];
    words.push({
      word,
      punctuated_word: typeof punctuated === 'string' ? punctuated : undefined,
      speaker: typeof speaker === 'number' ? speaker : undefined,
    });
  }
  return words;
}

// Group consecutive words by their `speaker` index into labeled lines.
// Speaker indices are 0-based in Deepgram; we render them 1-based for humans.
function buildDiarizedTranscript(words: DeepgramWord[]): string {
  if (words.length === 0) return '';

  const lines: string[] = [];
  let currentSpeaker: number | undefined;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const label =
      currentSpeaker === undefined
        ? 'Ομιλητής'
        : `Ομιλητής ${currentSpeaker + 1}`;
    lines.push(`${label}: ${buffer.join(' ').trim()}`);
    buffer = [];
  };

  for (const w of words) {
    if (w.speaker !== currentSpeaker && buffer.length > 0) {
      flush();
    }
    currentSpeaker = w.speaker;
    buffer.push(w.punctuated_word ?? w.word);
  }
  flush();

  return lines.join('\n').trim();
}

// POST the raw audio bytes to Deepgram and return a diarized transcript.
// Returns null on missing key, network error, timeout, bad status, or empty
// result — every null path is a clean signal to fall back to OpenAI.
async function transcribeWithDeepgram(audioFile: File): Promise<string | null> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);

  try {
    const body = await audioFile.arrayBuffer();
    const res = await fetch(DEEPGRAM_LISTEN_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': audioFile.type || 'audio/wav',
      },
      body,
    });

    if (!res.ok) {
      console.error('openai-call-audio: deepgram returned', res.status);
      return null;
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      console.error('openai-call-audio: failed to parse deepgram response');
      return null;
    }

    const words = extractDeepgramWords(data);
    const diarized = buildDiarizedTranscript(words);
    if (!diarized) {
      console.error('openai-call-audio: deepgram returned no transcript');
      return null;
    }
    return diarized;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('openai-call-audio: deepgram timed out');
    } else {
      console.error('openai-call-audio: deepgram fetch error');
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  dialStatus: string | null,
  hasSpeakerLabels: boolean
): string {
  const contextLines: string[] = [];
  if (callerNumber) contextLines.push(`Αριθμός καλούντος: ${callerNumber}`);
  if (dialStatus) contextLines.push(`Αποτέλεσμα κλήσης: ${dialStatus}`);

  const contextSection = contextLines.length > 0
    ? `Μεταδεδομένα: ${contextLines.join(', ')}\n\n`
    : '';

  const speakerGuidance = hasSpeakerLabels
    ? [
        'Η μεταγραφή έχει ετικέτες ομιλητών (π.χ. "Ομιλητής 1", "Ομιλητής 2").',
        'Χρησιμοποίησέ τες για να καταλάβεις ποιος είπε τι (πελάτης vs τεχνικός/επαγγελματίας) και απόδωσε σωστά αιτήματα και συμφωνίες στον σωστό ομιλητή.',
        'Μην αναφέρεις τις ετικέτες "Ομιλητής X" αυτούσιες στο brief· απλώς απόδωσε σωστά ποιος ζητά τι.',
      ]
    : [];

  return [
    'Είσαι βοηθός CRM για Έλληνα επαγγελματία (π.χ. τεχνικό, υδραυλικό, συνεργείο).',
    'Βασίσου ΑΠΟΚΛΕΙΣΤΙΚΑ στη μεταγραφή κλήσης παρακάτω. Μην επινοείς ΤΙΠΟΤΑ που δεν λέγεται ρητά — ούτε αιτήματα, ούτε ραντεβού, ούτε ακυρώσεις, ούτε προθέσεις. Αν δεν ειπώθηκε, ΔΕΝ το γράφεις.',
    'ΑΝ η μεταγραφή είναι κενή, ασαφής, μόνο ήχοι/σιωπή, τηλεφωνητής, ή δεν περιέχει πραγματική αμφίδρομη συνομιλία, γράψε ΜΟΝΟ την ακριβή φράση: «Χωρίς συνομιλία.» και ΤΙΠΟΤΑ άλλο (καμία σύνοψη, καμία ενότητα).',
    ...speakerGuidance,
    'Διαφορετικά, γράψε ΑΝΑΛΥΤΙΚΟ αλλά καθαρό CRM brief στα ελληνικά, με ΑΚΡΙΒΩΣ την παρακάτω δομή και τίτλους ενοτήτων:',
    '',
    '1) Ξεκίνα κατευθείαν με μια Σύνοψη 2-4 προτάσεων (ΧΩΡΙΣ τίτλο/πρόλογο): τι αφορούσε η κλήση, το αίτημα/πρόβλημα του πελάτη και το βασικό αποτέλεσμα ή συμφωνία.',
    '',
    '2) Μία κενή γραμμή, μετά ακριβώς ο τίτλος «Λεπτομέρειες:» και από κάτω bullets με «• » που καλύπτουν ΟΛΑ τα συγκεκριμένα στοιχεία που ειπώθηκαν — ΜΗΝ παραλείπεις τίποτα ουσιαστικό:',
    '   - το αίτημα/πρόβλημα και τα συμπτώματα όπως τα περιέγραψε ο πελάτης,',
    '   - τι προτάθηκε ή συμφωνήθηκε (λύσεις, εργασίες, υλικά),',
    '   - τιμές, ποσά, εκτιμήσεις κόστους,',
    '   - ημερομηνίες, ώρες, ραντεβού,',
    '   - διευθύνσεις, τοποθεσίες, ονόματα,',
    '   - παράπονα, ενστάσεις ή αμφιβολίες του πελάτη,',
    '   - οτιδήποτε άλλο σημαντικό ειπώθηκε.',
    '   Χρησιμοποίησε όσα bullets χρειάζονται για να μην χαθεί λεπτομέρεια (συνήθως 3 έως 10).',
    '',
    '3) Μία κενή γραμμή, μετά ακριβώς ο τίτλος «Επόμενα βήματα:» και από κάτω 1 έως 4 σύντομα, συγκεκριμένα, πρακτικά βήματα ενέργειας, καθένα σε δική του γραμμή με «• » (π.χ. «• Κάλεσε πίσω για επιβεβαίωση ώρας», «• Ετοίμασε προσφορά για αλλαγή λέβητα»). Αν δεν προκύπτει σαφές βήμα, γράψε μόνο «• Καμία ενέργεια απαιτείται».',
    '',
    'Κανόνες: μόνο ελληνικά· μόνο bullets με «• » (όχι αριθμημένες λίστες)· χωρίς να παραθέτεις αυτούσια τη μεταγραφή· χωρίς JSON· χωρίς άλλους τίτλους πέρα από τους τρεις παραπάνω.',
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

  const openaiTranscriptionModel =
    process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-transcribe';
  const briefModel =
    process.env.OPENAI_BRIEF_MODEL?.trim() || 'gpt-4o';

  // ---------------------------------------------------------------------------
  // Step 1: Transcription
  //
  // Preferred path: Deepgram nova-2 with 2-speaker diarization (env-gated on
  // DEEPGRAM_API_KEY). Produces a speaker-labeled transcript ("Ομιλητής 1: …").
  // If Deepgram is unset, fails, or returns nothing, we fall back to the
  // original OpenAI flat transcription below. `transcriptionModel` records
  // which path actually produced the transcript.
  // ---------------------------------------------------------------------------
  let transcript: string | null = null;
  let transcriptionModel: string = openaiTranscriptionModel;
  let hasSpeakerLabels = false;

  const diarized = await transcribeWithDeepgram(input.audioFile);
  if (diarized) {
    transcript = diarized;
    transcriptionModel = DEEPGRAM_MODEL_LABEL;
    hasSpeakerLabels = true;
  }

  // Fallback: OpenAI transcription (also the default when DEEPGRAM_API_KEY is
  // unset). Unchanged behavior from before.
  if (transcript === null) {
    const transcriptionForm = new FormData();
    transcriptionForm.append('file', input.audioFile);
    transcriptionForm.append('model', openaiTranscriptionModel);
    transcriptionForm.append('language', 'el');
    transcriptionForm.append('response_format', 'json');

    const transcriptionController = new AbortController();
    const transcriptionTimer = setTimeout(
      () => transcriptionController.abort(),
      TRANSCRIPTION_TIMEOUT_MS
    );

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
      transcriptionModel = openaiTranscriptionModel;
      hasSpeakerLabels = false;
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
  }

  // ---------------------------------------------------------------------------
  // Step 2: Brief generation via Responses API
  // ---------------------------------------------------------------------------
  const briefPrompt = buildBriefPrompt(
    transcript,
    input.callerNumber,
    input.dialStatus,
    hasSpeakerLabels
  );

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

    // No «AI brief …:» prefix — the UI already labels it «Περίληψη κλήσης».
    // Strip a legacy prefix if the model still emits one.
    brief = text.replace(/^AI brief[^:\n]*:\s*/i, '').trim();
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
