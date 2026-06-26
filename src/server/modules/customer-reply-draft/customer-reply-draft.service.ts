// Customer-reply-draft — service (context gathering + prompt assembly for
// POST /api/customers/[id]/reply-draft).
//
// Parity-matched to the original route. The Anthropic call itself (model, headers,
// AbortController timeout) stays in the ROUTE verbatim — only the grounding-context
// reads (customer + recent communications + service catalog), the prompt assembly and
// the response-text extraction (the testable, non-AI logic) live here. No external-AI
// or `@/`-aliased imports, so the unit tests stay hermetic.

import type { createServerSupabaseClient } from '../../../lib/supabase/server';

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Extract the first non-empty text block from an Anthropic Messages response. */
export function extractDraftText(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const content = data['content'];
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0];
  if (!isRecord(first)) return null;
  const t = first['text'];
  return typeof t === 'string' && t.trim().length > 0 ? t.trim() : null;
}

export type ReplyDraftContext =
  | { kind: 'not_found' }
  | { kind: 'ok'; prompt: string };

/**
 * Gather the grounding context (all scoped to this business + customer) and assemble
 * the Greek reply-draft prompt. Returns { kind: 'not_found' } when the customer is
 * missing (→ 404 route-side), otherwise the assembled prompt for the model call.
 */
export async function buildReplyDraftContext(
  supabase: SupabaseClient,
  businessId: string,
  customerId: string,
  hint: string,
): Promise<ReplyDraftContext> {
  const [custRes, commsRes, catRes] = await Promise.all([
    supabase.from('customers').select('name, needs_summary, status').eq('id', customerId).eq('business_id', businessId).maybeSingle(),
    supabase.from('communications').select('channel, direction, summary, created_at').eq('business_id', businessId).eq('customer_id', customerId).order('created_at', { ascending: false }).limit(8),
    supabase.from('service_catalog_items').select('name').eq('business_id', businessId).limit(25),
  ]);

  const customer = custRes.data as { name?: string | null; needs_summary?: string | null } | null;
  if (!customer) {
    return { kind: 'not_found' };
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

  return { kind: 'ok', prompt };
}
