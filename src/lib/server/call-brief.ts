// Server-only helper: generates a demo-safe AI call brief from PBX call metadata.
// This is NOT a transcript. It uses only structured metadata to produce a short
// Greek CRM draft that requires human review before any action is taken.
// No recording path, intake URL, or secrets are included in the prompt.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const CALL_BRIEF_TIMEOUT_MS = 6_000;
const CALL_BRIEF_MAX_TOKENS = 350;

export interface CallBriefInput {
  callerNumber: string | null;
  dialStatus: string | null;
  uniqueId: string | null;
  recordingExists: boolean | null;
  recordingSizeBytes: number | null;
  recordingFallbackApplied: boolean | null;
  customerCreated: boolean;
  customerMatched: boolean;
  intakeUrlCreated: boolean;
  viberSendStatus: string | null;
}

function buildBriefPrompt(input: CallBriefInput): string {
  const lines: string[] = [
    'Είσαι βοηθός CRM για επαγγελματία.',
    'Παρακάτω υπάρχουν μόνο τεχνικά μεταδεδομένα μιας εισερχόμενης κλήσης.',
    'ΔΕΝ υπάρχει ηχογράφηση, μεταγραφή ή περιεχόμενο κλήσης.',
    'Χρησιμοποίησε ΜΟΝΟ τα παρακάτω μεταδεδομένα.',
    '',
    '--- Μεταδεδομένα κλήσης ---',
    `Αριθμός καλούντος: ${input.callerNumber ?? 'Άγνωστος'}`,
    `Αποτέλεσμα κλήσης (dialstatus): ${input.dialStatus ?? 'Άγνωστο'}`,
    `Ηχογράφηση υπάρχει: ${input.recordingExists === true ? 'Ναι' : input.recordingExists === false ? 'Όχι' : 'Άγνωστο'}`,
    input.recordingSizeBytes !== null ? `Μέγεθος ηχογράφησης: ${input.recordingSizeBytes} bytes` : null,
    input.recordingFallbackApplied === true ? 'Σημείωση: εφαρμόστηκε fallback για ηχογράφηση.' : null,
    `Πελάτης: ${input.customerCreated ? 'Δημιουργήθηκε νέος' : input.customerMatched ? 'Αναγνωρίστηκε υπάρχων' : 'Δεν αναγνωρίστηκε'}`,
    `Φόρμα στοιχείων εστάλη: ${input.intakeUrlCreated ? 'Ναι' : 'Όχι'}`,
    input.viberSendStatus ? `Κατάσταση Viber: ${input.viberSendStatus}` : null,
    '---',
    '',
    'Γράψε ένα σύντομο επαγγελματικό σχέδιο CRM σε απλά ελληνικά, ΓΙΑ ΕΛΕΓΧΟ από τον επαγγελματία.',
    'Εφόσον το περιεχόμενο της κλήσης είναι άγνωστο, ανάφερε την αβεβαιότητα ρητά.',
    '',
    'Απόκριση: μόνο απλό κείμενο, χωρίς JSON, χωρίς bullet points, χωρίς markdown.',
    'Ξεκίνα με: AI brief προς έλεγχο:',
    '',
    'Συμπέριλαβε με τη σειρά:',
    '1. Τι έγινε - περίληψη βάσει μεταδεδομένων μόνο, με ρητή αβεβαιότητα για το περιεχόμενο.',
    '2. Κατάσταση πελάτη - νέος, υπάρχων ή άγνωστος.',
    '3. Επόμενη ενέργεια - βάσει των διαθέσιμων πληροφοριών.',
    '4. Τι λείπει - τι χρειάζεται για πλήρη αξιολόγηση (π.χ. ακρόαση ηχογράφησης, επιβεβαίωση στοιχείων).',
  ].filter((l): l is string => l !== null);

  return lines.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractText(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const content = data['content'];
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  if (!isRecord(first)) return null;
  const text = first['text'];
  return typeof text === 'string' && text.trim().length > 0 ? text.trim() : null;
}

export async function generateCallBrief(input: CallBriefInput): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const prompt = buildBriefPrompt(input);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CALL_BRIEF_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: CALL_BRIEF_MAX_TOKENS,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('call-brief: Anthropic returned', res.status);
      return null;
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      console.error('call-brief: failed to parse Anthropic response as JSON');
      return null;
    }

    const text = extractText(data);
    if (!text) {
      console.error('call-brief: Anthropic response missing text content');
      return null;
    }

    // Ensure the brief starts with the required prefix regardless of model variance.
    if (!text.startsWith('AI brief')) {
      return `AI brief προς έλεγχο:\n${text}`;
    }
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('call-brief: Anthropic request timed out');
    } else {
      console.error('call-brief: Anthropic fetch error');
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
