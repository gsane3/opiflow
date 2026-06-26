// AI assistant — service. Parity-matched to /api/ai/cmd, /api/ai/transcribe,
// /api/ai/review and /api/ai/customer-memory.
//
// Each function owns the POST-AUTH logic only: prompt build, the external AI
// fetch (Anthropic / OpenAI / Deepgram — verbatim URL, model string, headers,
// timeout, and result parsing), and response parsing. Each returns a discriminated
// result the route maps to the EXACT NextResponse it returned before (same code,
// same status, same body shape, same key order). The auth/rate-limit/secret gates
// stay in the route. No behaviour changes.

import { buildCmdPrompt } from '../../../lib/ai/cmd-prompt';
import { parseCmdResponse, type CmdReviewResult } from '../../../lib/ai/cmd-schema';
import { buildPrompt } from '../../../lib/ai/prompt';
import { parseAiResponse, type AiReviewResult } from '../../../lib/ai/schema';
import { transcribeWithOpenAI } from '../../../lib/server/openai-call-audio';
import type { BusinessType } from '../../../lib/types';
import {
  fetchCommsContext,
  fetchCustomerContext,
  fetchOffersContext,
  fetchTasksContext,
  type CommContextRow,
  type CustomerContextRow,
  type OfferContextRow,
  type TaskContextRow,
} from './ai.repo';
import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;

// ===========================================================================
// /api/ai/cmd
// ===========================================================================

const CMD_AI_TIMEOUT_MS = 20_000;

export type RunCmdResult =
  | { ok: true; result: CmdReviewResult }
  | { ok: false; code: 'ai_failed'; status: 502 }
  | { ok: false; code: 'ai_timeout'; status: 504 };

/** Post-auth/validation logic for /api/ai/cmd: build prompt, call Anthropic (haiku),
 *  and parse. The route applies the best-effort offer-price enrichment afterwards
 *  (it does its own auth). Mirrors the route's exact codes/statuses. */
export async function runCmd(
  apiKey: string,
  input: { inputText: string; businessType?: string; businessName?: string },
): Promise<RunCmdResult> {
  const prompt = buildCmdPrompt({
    inputText: input.inputText,
    businessType: input.businessType,
    businessName: input.businessName,
  });

  let rawText: string;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CMD_AI_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      return { ok: false, code: 'ai_failed', status: 502 };
    }

    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    rawText = data?.content?.[0]?.text ?? '';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, code: 'ai_timeout', status: 504 };
    }
    return { ok: false, code: 'ai_failed', status: 502 };
  } finally {
    clearTimeout(timeoutId);
  }

  const result = parseCmdResponse(rawText);
  return { ok: true, result };
}

// ===========================================================================
// /api/ai/transcribe
// ===========================================================================

function extFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'm4a';
}

export type RunTranscribeResult =
  | { ok: true; text: string }
  | { ok: false; code: 'transcription_failed'; status: 502 };

/** Post-auth logic for /api/ai/transcribe: build the File from the base64 clip and
 *  transcribe with OpenAI (Greek). Mirrors the route's exact code/status. */
export async function runTranscribe(
  apiKey: string,
  mime: string,
  buf: Buffer,
): Promise<RunTranscribeResult> {
  const model = process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-transcribe';
  // Buffer → a plain ArrayBuffer slice so it's a valid BlobPart for File().
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const file = new File([ab], `voice.${extFor(mime)}`, { type: mime });

  const text = await transcribeWithOpenAI(file, model, apiKey);
  if (!text) return { ok: false, code: 'transcription_failed', status: 502 };
  return { ok: true, text };
}

// ===========================================================================
// /api/ai/review
// ===========================================================================

const AI_PROVIDER_TIMEOUT_MS = 20_000;

export type RunReviewResult =
  | { ok: true; result: AiReviewResult }
  | { ok: false; code: 'ai_failed'; status: 502 }
  | { ok: false; code: 'ai_timeout'; status: 504 }
  | { ok: false; code: 'invalid_response'; status: 502 };

/** Post-auth/validation logic for /api/ai/review: build prompt, call Anthropic (haiku),
 *  strip code fences + JSON.parse, and shape with parseAiResponse. Exact codes/statuses. */
export async function runReview(
  input: {
    inputText: string;
    businessType?: BusinessType;
    businessName?: string;
    defaultVatRate?: number;
  },
  apiKey: string,
): Promise<RunReviewResult> {
  const prompt = buildPrompt({
    inputText: input.inputText,
    businessType: input.businessType,
    businessName: input.businessName,
    defaultVatRate: input.defaultVatRate,
  });

  let rawText: string;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      console.error('Anthropic API error:', res.status, await res.text());
      return { ok: false, code: 'ai_failed', status: 502 };
    }

    const data = await res.json() as { content?: Array<{ text?: string }> };
    rawText = data?.content?.[0]?.text ?? '';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, code: 'ai_timeout', status: 504 };
    }
    console.error('Anthropic fetch error:', err);
    return { ok: false, code: 'ai_failed', status: 502 };
  } finally {
    clearTimeout(timeoutId);
  }

  let parsed: unknown;
  try {
    // Strip optional markdown code fences the model may add
    const cleaned = rawText
      .replace(/^```(?:json)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.error('AI response JSON parse failed. Raw:', rawText.slice(0, 300));
    return { ok: false, code: 'invalid_response', status: 502 };
  }

  const result = parseAiResponse(parsed);
  return { ok: true, result };
}

// ===========================================================================
// /api/ai/customer-memory
// ===========================================================================

const MEMORY_AI_TIMEOUT_MS = 20_000;

function strOrEmpty(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function industryInstruction(type: string): string {
  if (type === 'technical_services') {
    return 'Εστίασε σε τεχνική φύση εργασίας, υλικά, χρονοδιάγραμμα επέμβασης και αν χρειάζεται αυτοψία.';
  }
  if (type === 'sales_services') {
    return 'Εστίασε σε προϊόντα ενδιαφέροντος, ποσότητες, τιμή, budget και χρόνο απόφασης.';
  }
  if (type === 'projects_construction') {
    return 'Εστίασε σε φάση έργου, χώρο έργου, υλικά, άδειες, χρονοδιάγραμμα και προϋπολογισμό.';
  }
  return 'Εστίασε σε κύριες ανάγκες, κατάσταση σχέσης και επόμενη ενέργεια.';
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Νέος πελάτης',
  in_progress: 'Σε εξέλιξη',
  new_lead: 'Νέος πελάτης',
  contacted: 'Επικοινωνία έγινε',
  follow_up_needed: 'Απαιτείται follow-up',
  offer_drafted: 'Προσφορά σε draft',
  offer_sent: 'Προσφορά εστάλη',
  won: 'Κερδήθηκε',
  lost: 'Χάθηκε',
};

export function buildMemoryPrompt(params: {
  businessName: string;
  businessType: string;
  customer: CustomerContextRow;
  comms: CommContextRow[];
  tasks: TaskContextRow[];
  offers: OfferContextRow[];
  triggerEvent: string | null;
}): string {
  const { businessName, businessType, customer, comms, tasks, offers, triggerEvent } = params;
  const lines: string[] = [];

  lines.push(`Επιχείρηση: ${businessName} (${businessType})`);
  lines.push(industryInstruction(businessType));
  lines.push('');

  lines.push('ΠΕΛΑΤΗΣ:');
  lines.push(`  Όνομα: ${strOrEmpty(customer.name) || '(άγνωστο)'}`);
  if (customer.company_name) lines.push(`  Εταιρεία: ${customer.company_name}`);
  lines.push(`  CRM κατάσταση: ${STATUS_LABELS[customer.status] ?? customer.status}`);
  if (customer.source) lines.push(`  Πηγή: ${customer.source}`);
  if (customer.needs_summary) lines.push(`  Ανάγκη: ${customer.needs_summary}`);
  lines.push('');

  lines.push('ΤΡΕΧΟΥΣΑ ΜΝΗΜΗ:');
  lines.push(`  Τρέχουσα κατάσταση: ${strOrEmpty(customer.status_summary) || '(κενό)'}`);
  lines.push(`  Επαγγελματικές σημειώσεις: ${strOrEmpty(customer.business_notes) || '(κενό)'}`);
  lines.push(`  Προσωπικά: ${strOrEmpty(customer.personal_notes) || '(κενό)'}`);
  lines.push(`  Επόμενη ενέργεια: ${strOrEmpty(customer.next_best_action) || '(κενό)'}`);
  lines.push('');

  if (triggerEvent) {
    lines.push(`ΑΦΟΡΜΗ ΕΝΗΜΕΡΩΣΗΣ: ${triggerEvent}`);
    lines.push('');
  }

  const commsWithSummary = comms.filter((c) => c.summary && c.summary.trim().length > 0);
  if (commsWithSummary.length > 0) {
    lines.push('ΠΡΟΣΦΑΤΑ ΓΕΓΟΝΟΤΑ (επικοινωνίες):');
    for (const c of commsWithSummary) {
      const date = c.created_at.split('T')[0];
      const dir = c.direction === 'inbound' ? 'εισερχόμενο' : 'εξερχόμενο';
      lines.push(`  [${date}] ${c.channel} ${dir}: ${c.summary}`);
    }
    lines.push('');
  }

  if (tasks.length > 0) {
    lines.push('ΑΝΟΙΧΤΑ TASKS:');
    for (const t of tasks) {
      const dueStr = t.due_date ? ` (προθεσμία ${t.due_date})` : '';
      const aiTag = t.created_from_ai ? ' [AI]' : '';
      lines.push(`  ${t.title} - ${t.type}${dueStr}${aiTag}`);
      if (t.note) lines.push(`    Σημ: ${t.note.slice(0, 100)}`);
    }
    lines.push('');
  }

  if (offers.length > 0) {
    lines.push('ΠΡΟΣΦΟΡΕΣ:');
    for (const o of offers) {
      const dateStr = o.offer_date ? ` (${o.offer_date})` : '';
      lines.push(`  ${o.offer_number} - ${o.status} - ${o.total}€${dateStr}`);
    }
    lines.push('');
  }

  lines.push('ΟΔΗΓΙΕΣ:');
  lines.push('1. Πρότεινε ενημέρωση ΜΟΝΟ αν υπάρχουν νέα, σαφή δεδομένα από τα παραπάνω.');
  lines.push('2. proposedStatusSummary: σύντομη πρόταση για την τρέχουσα κατάσταση της σχέσης με τον πελάτη.');
  lines.push('3. proposedBusinessNotes: μόνο επαγγελματικές πληροφορίες. Μην επαναλαμβάνεις ήδη γνωστά αν δεν υπάρχουν νέα στοιχεία.');
  lines.push('4. proposedPersonalNotes: ΜΟΝΟ αν βρεις ρητά προσωπικά στοιχεία στα κείμενα. Δεν εφευρίσκεις. Δεν υποθέτεις. Αν δεν υπάρχει κάτι ρητό, επέστρεψε null ή διατήρησε την τρέχουσα τιμή αν είναι έγκυρη.');
  lines.push('5. proposedNextBestAction: σύντομη ενέργεια χωρίς συγκεκριμένη ημερομηνία.');
  lines.push('6. Αν τα δεδομένα είναι ανεπαρκή, επέστρεψε null στα σχετικά πεδία και πρόσθεσε προειδοποίηση.');
  lines.push('7. confidence: "low" αν είναι λίγα δεδομένα, "medium" αν υπάρχουν μερικά, "high" αν είναι σαφές.');
  lines.push('8. Απάντα ΜΟΝΟ με valid JSON. Χωρίς markdown. Χωρίς επεξήγηση εκτός JSON. Όλα τα κείμενα στα Ελληνικά.');
  lines.push('');
  lines.push('JSON schema (επέστρεψε ακριβώς αυτό):');
  lines.push('{');
  lines.push('  "proposedStatusSummary": string | null,');
  lines.push('  "proposedBusinessNotes": string | null,');
  lines.push('  "proposedPersonalNotes": string | null,');
  lines.push('  "proposedNextBestAction": string | null,');
  lines.push('  "confidence": "low" | "medium" | "high",');
  lines.push('  "warnings": string[]');
  lines.push('}');

  return lines.join('\n');
}

const CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const;
type Confidence = (typeof CONFIDENCE_VALUES)[number];

export interface MemorySuggestion {
  proposedStatusSummary: string | null;
  proposedBusinessNotes: string | null;
  proposedPersonalNotes: string | null;
  proposedNextBestAction: string | null;
  confidence: Confidence;
  warnings: string[];
}

export function parseSuggestion(rawText: string): MemorySuggestion {
  const fallback: MemorySuggestion = {
    proposedStatusSummary: null,
    proposedBusinessNotes: null,
    proposedPersonalNotes: null,
    proposedNextBestAction: null,
    confidence: 'low',
    warnings: ['Η απάντηση AI δεν μπορεί να αναλυθεί.'],
  };

  let parsed: unknown;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return fallback;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fallback;
  }

  const raw = parsed as Record<string, unknown>;

  function parseField(val: unknown): string | null {
    if (val === null || val === undefined) return null;
    if (typeof val !== 'string') return null;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const confidence: Confidence = (CONFIDENCE_VALUES as readonly string[]).includes(raw.confidence as string)
    ? (raw.confidence as Confidence)
    : 'low';

  const warnings: string[] = Array.isArray(raw.warnings)
    ? (raw.warnings as unknown[])
        .filter((w) => typeof w === 'string' && (w as string).trim().length > 0)
        .map((w) => (w as string).trim())
    : [];

  return {
    proposedStatusSummary: parseField(raw.proposedStatusSummary),
    proposedBusinessNotes: parseField(raw.proposedBusinessNotes),
    proposedPersonalNotes: parseField(raw.proposedPersonalNotes),
    proposedNextBestAction: parseField(raw.proposedNextBestAction),
    confidence,
    warnings,
  };
}

export type RunCustomerMemoryResult =
  | { ok: true; suggestion: MemorySuggestion }
  | { ok: false; code: 'customer_query_failed'; status: 500 }
  | { ok: false; code: 'customer_not_found'; status: 404 }
  | { ok: false; code: 'ai_failed'; status: 502 }
  | { ok: false; code: 'ai_timeout'; status: 504 };

/**
 * Post-auth logic for /api/ai/customer-memory after the business is resolved (by the
 * route) and the body validated: load the customer (scoped to the business) + last 5
 * comms / 3 open tasks / 3 offers (non-blocking), build the prompt, call Anthropic
 * (haiku), and parse. Mirrors the route's exact codes/statuses/order; the
 * comms/tasks/offers loads swallow errors exactly as the route does.
 */
export async function runCustomerMemory(
  supabase: SupabaseServer,
  apiKey: string,
  business: { id: string; name: string; type: string },
  input: { customerId: string; triggerEvent: string | null },
): Promise<RunCustomerMemoryResult> {
  // Load customer (scoped to business)
  let customer: CustomerContextRow;
  try {
    const { data, error } = await fetchCustomerContext(supabase, input.customerId, business.id);

    if (error) {
      return { ok: false, code: 'customer_query_failed', status: 500 };
    }
    if (!data) {
      return { ok: false, code: 'customer_not_found', status: 404 };
    }
    customer = data as unknown as CustomerContextRow;
  } catch {
    return { ok: false, code: 'customer_query_failed', status: 500 };
  }

  // Load last 5 communications (non-blocking on failure)
  let comms: CommContextRow[] = [];
  try {
    comms = await fetchCommsContext(supabase, input.customerId, business.id);
  } catch {
    // Non-blocking: proceed without communications
  }

  // Load last 3 open/ai_draft tasks (non-blocking on failure)
  let tasks: TaskContextRow[] = [];
  try {
    tasks = await fetchTasksContext(supabase, input.customerId, business.id);
  } catch {
    // Non-blocking: proceed without tasks
  }

  // Load last 3 offers (non-blocking on failure)
  let offers: OfferContextRow[] = [];
  try {
    offers = await fetchOffersContext(supabase, input.customerId, business.id);
  } catch {
    // Non-blocking: proceed without offers
  }

  const prompt = buildMemoryPrompt({
    businessName: business.name,
    businessType: business.type,
    customer,
    comms,
    tasks,
    offers,
    triggerEvent: input.triggerEvent,
  });

  // Call AI
  let rawText: string;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MEMORY_AI_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      return { ok: false, code: 'ai_failed', status: 502 };
    }

    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    rawText = data?.content?.[0]?.text ?? '';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, code: 'ai_timeout', status: 504 };
    }
    return { ok: false, code: 'ai_failed', status: 502 };
  } finally {
    clearTimeout(timeoutId);
  }

  const suggestion = parseSuggestion(rawText);
  return { ok: true, suggestion };
}
