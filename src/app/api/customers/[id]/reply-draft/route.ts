// POST /api/customers/[id]/reply-draft
//
// Drafts a short Greek reply to send to the customer, grounded in the recent
// conversation (call briefs + messages), the customer's needs, and the service
// catalog. Review-first: returns the text; the operator edits + taps send.
// Never auto-sends. INERT (503) when ANTHROPIC_API_KEY is unset.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';

export const runtime = 'nodejs';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 12_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function extractText(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const content = data['content'];
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  if (!isRecord(first)) return null;
  const t = first['text'];
  return typeof t === 'string' && t.trim().length > 0 ? t.trim() : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;
  const { id: customerId } = await params;

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'ai_not_configured' }, { status: 503 });
  }

  // Optional operator hint ("πες του ότι θα έρθουμε αύριο").
  let hint = '';
  try {
    const body = await request.json();
    if (isRecord(body) && typeof body.hint === 'string') hint = body.hint.trim().slice(0, 300);
  } catch {
    // no body is fine
  }

  // Gather grounding context (all scoped to this business + customer).
  const [custRes, commsRes, catRes] = await Promise.all([
    supabase.from('customers').select('name, needs_summary, status').eq('id', customerId).eq('business_id', businessId).maybeSingle(),
    supabase.from('communications').select('channel, direction, summary, created_at').eq('business_id', businessId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(8),
    supabase.from('service_catalog_items').select('name').eq('business_id', businessId).limit(25),
  ]);

  const customer = custRes.data as { name?: string | null; needs_summary?: string | null } | null;
  if (!customer) {
    return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
  }

  const comms = ((commsRes.data ?? []) as Array<{ channel: string; direction: string; summary: string | null; created_at: string }>)
    .reverse()
    .map((c) => {
      const who = c.direction === 'inbound' ? 'Πελάτης' : 'Εμείς';
      const what = (c.summary ?? '').split('\n')[0].slice(0, 200);
      return what ? `${who} (${c.channel}): ${what}` : null;
    })
    .filter(Boolean)
    .join('\n');

  const catalog = ((catRes.data ?? []) as Array<{ name: string }>).map((c) => c.name).filter(Boolean).join(', ');

  const prompt = [
    'Είσαι βοηθός ενός Έλληνα επαγγελματία τεχνικού και γράφεις ΜΙΑ σύντομη, ευγενική απάντηση προς τον πελάτη του.',
    'Γράψε ΜΟΝΟ το κείμενο του μηνύματος, σε φυσικά ελληνικά, χωρίς εισαγωγικά, χωρίς υπογραφή, χωρίς εξηγήσεις.',
    'Κράτησέ το σύντομο (1-3 προτάσεις), πρακτικό και φιλικό. Μην υπόσχεσαι τιμές ή ώρες που δεν αναφέρονται.',
    'Αν απευθυνθείς στον πελάτη με το επώνυμό του, χρησιμοποίησε ΚΛΗΤΙΚΗ πτώση: «κύριε Παπαδόπουλε», «κυρία Γεωργίου» — ΟΧΙ «κύριε Παπαδόπουλος». Αν δεν είσαι σίγουρος/η για τη σωστή κλητική, χρησιμοποίησε το μικρό όνομα ή έναν ουδέτερο χαιρετισμό («Καλησπέρα σας»).',
    customer.name ? `Όνομα πελάτη: ${customer.name}` : null,
    customer.needs_summary ? `Ανάγκες πελάτη: ${customer.needs_summary}` : null,
    catalog ? `Υπηρεσίες της επιχείρησης (για συμφραζόμενα): ${catalog}` : null,
    hint ? `Οδηγία επαγγελματία για την απάντηση: ${hint}` : null,
    '',
    comms ? `Πρόσφατη συνομιλία (παλαιότερο → νεότερο):\n${comms}` : 'Δεν υπάρχει προηγούμενη συνομιλία — γράψε μια ευγενική εναρκτήρια απάντηση.',
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        temperature: 0.5,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
    const data = await res.json().catch(() => null);
    const draft = extractText(data);
    if (!draft) return NextResponse.json({ ok: false, error: 'ai_empty' }, { status: 502 });
    return NextResponse.json({ ok: true, draft });
  } catch {
    return NextResponse.json({ ok: false, error: 'ai_failed' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
