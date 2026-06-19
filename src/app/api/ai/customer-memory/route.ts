// POST /api/ai/customer-memory
// Authenticated endpoint that suggests customer memory updates from recent CRM context.
// Requires Bearer token. Loads context server-side scoped to the authenticated business.
// Returns proposed field values only. Does not write to the database.
// Review-first: the user must approve by saving via PATCH /api/customers/[id].

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveBusinessContext } from '@/lib/api/auth';

export const runtime = 'nodejs';

const AI_TIMEOUT_MS = 20_000;
const MEMORY_MAX_BODY_BYTES = 8_000;

const MEMORY_RATE_LIMIT_MAX = 5;
const MEMORY_RATE_LIMIT_WINDOW_MS = 60_000;
const memoryRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = memoryRateLimitStore.get(ip);
  if (!entry || now >= entry.resetAt) {
    memoryRateLimitStore.set(ip, { count: 1, resetAt: now + MEMORY_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (entry.count >= MEMORY_RATE_LIMIT_MAX) return true;
  entry.count += 1;
  return false;
}

function getBearerToken(request: NextRequest): string | null {
  const h = request.headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

async function getBusinessContext(
  supabase: SupabaseClient,
  userId: string
): Promise<{ id: string; name: string; type: string } | null> {
  // Membership-aware (not owner_id) so invited team members get their business.
  const resolved = await resolveBusinessContext(supabase, userId);
  if (!resolved) return null;
  const { data } = await supabase
    .from('businesses')
    .select('id, name, type')
    .eq('id', resolved.businessId)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { id: string; name: string | null; type: string | null };
  return { id: row.id, name: row.name ?? '', type: row.type ?? 'other' };
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface CustomerContextRow {
  id: string;
  name: string | null;
  company_name: string | null;
  status: string;
  source: string | null;
  needs_summary: string | null;
  status_summary: string | null;
  business_notes: string | null;
  personal_notes: string | null;
  next_best_action: string | null;
}

interface CommContextRow {
  summary: string | null;
  channel: string;
  direction: string;
  created_at: string;
}

interface TaskContextRow {
  title: string;
  type: string;
  status: string;
  due_date: string | null;
  note: string | null;
  created_from_ai: boolean;
}

interface OfferContextRow {
  offer_number: string;
  status: string;
  total: number;
  offer_date: string | null;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

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

function buildPrompt(params: {
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

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

const CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const;
type Confidence = (typeof CONFIDENCE_VALUES)[number];

interface MemorySuggestion {
  proposedStatusSummary: string | null;
  proposedBusinessNotes: string | null;
  proposedPersonalNotes: string | null;
  proposedNextBestAction: string | null;
  confidence: Confidence;
  warnings: string[];
}

function parseSuggestion(rawText: string): MemorySuggestion {
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

// ---------------------------------------------------------------------------
// POST /api/ai/customer-memory
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (isRateLimited(getClientIp(request))) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const cl = parseInt(contentLengthRaw, 10);
    if (!isNaN(cl) && cl > MEMORY_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    }
  }

  const token = getBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: 'missing_auth' }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'no_api_key' }, { status: 503 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createServerSupabaseClient();
  } catch (err) {
    if (err instanceof Error && err.message.includes('Missing Supabase server')) {
      return NextResponse.json({ ok: false, error: 'missing_supabase_config' }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: 'internal_error' }, { status: 500 });
  }

  // Validate session
  let userId: string;
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
    }
    userId = user.id;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_auth' }, { status: 401 });
  }

  // Load business
  let business: { id: string; name: string; type: string };
  try {
    const biz = await getBusinessContext(supabase, userId);
    if (!biz) {
      return NextResponse.json({ ok: false, error: 'business_not_found' }, { status: 404 });
    }
    business = biz;
  } catch {
    return NextResponse.json({ ok: false, error: 'business_query_failed' }, { status: 500 });
  }

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  }
  const raw = body as Record<string, unknown>;

  const customerId = typeof raw.customerId === 'string' ? raw.customerId.trim() : '';
  if (!customerId) {
    return NextResponse.json({ ok: false, error: 'missing_customer_id' }, { status: 400 });
  }
  const triggerEvent =
    typeof raw.triggerEvent === 'string' ? raw.triggerEvent.trim() || null : null;

  // Load customer (scoped to business)
  let customer: CustomerContextRow;
  try {
    const { data, error } = await supabase
      .from('customers')
      .select(
        'id, name, company_name, status, source, needs_summary, status_summary, business_notes, personal_notes, next_best_action'
      )
      .eq('id', customerId)
      .eq('business_id', business.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: 'customer_query_failed' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }
    customer = data as unknown as CustomerContextRow;
  } catch {
    return NextResponse.json({ ok: false, error: 'customer_query_failed' }, { status: 500 });
  }

  // Load last 5 communications (non-blocking on failure)
  let comms: CommContextRow[] = [];
  try {
    const { data } = await supabase
      .from('communications')
      .select('summary, channel, direction, created_at')
      .eq('customer_id', customerId)
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(5);
    comms = ((data ?? []) as unknown[]) as CommContextRow[];
  } catch {
    // Non-blocking: proceed without communications
  }

  // Load last 3 open/ai_draft tasks (non-blocking on failure)
  let tasks: TaskContextRow[] = [];
  try {
    const { data } = await supabase
      .from('tasks')
      .select('title, type, status, due_date, note, created_from_ai')
      .eq('customer_id', customerId)
      .eq('business_id', business.id)
      .in('status', ['open', 'ai_draft'])
      .order('due_date', { ascending: true })
      .limit(3);
    tasks = ((data ?? []) as unknown[]) as TaskContextRow[];
  } catch {
    // Non-blocking: proceed without tasks
  }

  // Load last 3 offers (non-blocking on failure)
  let offers: OfferContextRow[] = [];
  try {
    const { data } = await supabase
      .from('offers')
      .select('offer_number, status, total, offer_date')
      .eq('customer_id', customerId)
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(3);
    offers = ((data ?? []) as unknown[]) as OfferContextRow[];
  } catch {
    // Non-blocking: proceed without offers
  }

  const prompt = buildPrompt({
    businessName: business.name,
    businessType: business.type,
    customer,
    comms,
    tasks,
    offers,
    triggerEvent,
  });

  // Call AI
  let rawText: string;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
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
      return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
    }

    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    rawText = data?.content?.[0]?.text ?? '';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ ok: false, error: 'ai_timeout' }, { status: 504 });
    }
    return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }

  const suggestion = parseSuggestion(rawText);
  return NextResponse.json({ ok: true, suggestion });
}
