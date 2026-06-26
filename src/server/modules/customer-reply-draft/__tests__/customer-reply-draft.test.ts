import { describe, it, expect } from 'vitest';
import { buildReplyDraftContext, extractDraftText } from '../customer-reply-draft.service';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>;
type Res = { data?: unknown; error?: unknown };
interface FB {
  select(c?: string): FB; eq(a?: unknown, b?: unknown): FB; order(a?: unknown, b?: unknown): FB;
  limit(n?: number): FB; maybeSingle(): FB; then(r: (x: Res) => unknown): unknown;
}
function fakeClient(resolve: (table: string) => Res): SupabaseClient {
  function from(table: string): FB {
    const rec = () => (): FB => b;
    const b: FB = {
      select: rec(), eq: rec(), order: rec(), limit: rec(), maybeSingle: rec(),
      then: (r) => r(resolve(table)),
    };
    return b;
  }
  return { from } as unknown as SupabaseClient;
}

describe('extractDraftText', () => {
  it('returns the trimmed first text block', () => {
    expect(extractDraftText({ content: [{ text: '  Καλησπέρα σας  ' }] })).toBe('Καλησπέρα σας');
  });
  it('returns null for empty / malformed content', () => {
    expect(extractDraftText(null)).toBeNull();
    expect(extractDraftText({ content: [] })).toBeNull();
    expect(extractDraftText({ content: [{ text: '   ' }] })).toBeNull();
    expect(extractDraftText({ content: [{}] })).toBeNull();
  });
});

describe('buildReplyDraftContext (parity)', () => {
  it('not_found when the customer is missing', async () => {
    const c = fakeClient((t) => (t === 'customers' ? { data: null } : { data: [] }));
    expect(await buildReplyDraftContext(c, 'b1', 'cust1', '')).toEqual({ kind: 'not_found' });
  });

  it('assembles a prompt grounded in customer + comms + catalog + hint', async () => {
    const c = fakeClient((t) => {
      if (t === 'customers') return { data: { name: 'Γιώργος Παπαδόπουλος', needs_summary: 'Διαρροή' } };
      if (t === 'communications') return { data: [
        { channel: 'call', direction: 'inbound', summary: 'Θέλω ραντεβού\nδεύτερη γραμμή', created_at: '2026-06-02' },
        { channel: 'sms', direction: 'outbound', summary: 'Καλώς, αύριο', created_at: '2026-06-01' },
      ] };
      if (t === 'service_catalog_items') return { data: [{ name: 'Υδραυλικά' }, { name: 'Θέρμανση' }] };
      return { data: [] };
    });
    const res = await buildReplyDraftContext(c, 'b1', 'cust1', 'πες του ότι θα έρθουμε αύριο');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.prompt).toContain('Όνομα πελάτη: Γιώργος Παπαδόπουλος');
    expect(res.prompt).toContain('Ανάγκες πελάτη: Διαρροή');
    expect(res.prompt).toContain('Υπηρεσίες της επιχείρησης (για συμφραζόμενα): Υδραυλικά, Θέρμανση');
    expect(res.prompt).toContain('Οδηγία επαγγελματία για την απάντηση: πες του ότι θα έρθουμε αύριο');
    // comms reversed to oldest → newest, first summary line only, prefixed by speaker
    expect(res.prompt).toContain('Εμείς (sms): Καλώς, αύριο\nΠελάτης (call): Θέλω ραντεβού');
  });

  it('uses the no-prior-conversation fallback when there are no comms', async () => {
    const c = fakeClient((t) => {
      if (t === 'customers') return { data: { name: null, needs_summary: null } };
      return { data: [] };
    });
    const res = await buildReplyDraftContext(c, 'b1', 'cust1', '');
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.prompt).toContain('Δεν υπάρχει προηγούμενη συνομιλία');
  });
});
