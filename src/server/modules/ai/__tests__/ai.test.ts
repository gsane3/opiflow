import { describe, it, expect } from 'vitest';
import {
  buildMemoryPrompt,
  parseSuggestion,
  runCustomerMemory,
} from '../ai.service';
import type { createServerSupabaseClient } from '../../../../lib/supabase/server';

type SupabaseServer = ReturnType<typeof createServerSupabaseClient>;
type Res = { data?: unknown; error?: unknown };

// A thenable query builder whose every chainable method returns itself and which
// resolves to a per-table fixed result. Never performs real I/O.
interface QB {
  select(c?: string): QB;
  eq(a?: unknown, b?: unknown): QB;
  in(a?: unknown, b?: unknown): QB;
  order(a?: unknown, b?: unknown): QB;
  limit(n?: number): QB;
  maybeSingle(): QB;
  then(r: (x: Res) => unknown): unknown;
}

function fakeSupabase(resolve: (table: string) => Res): SupabaseServer {
  function from(table: string): QB {
    const ret = () => (): QB => qb;
    const qb: QB = {
      select: ret(), eq: ret(), in: ret(), order: ret(), limit: ret(), maybeSingle: ret(),
      then: (r) => r(resolve(table)),
    };
    return qb;
  }
  return { from } as unknown as SupabaseServer;
}

describe('parseSuggestion (parity)', () => {
  it('returns the fallback with a warning on unparseable text', () => {
    const s = parseSuggestion('not json at all');
    expect(s).toEqual({
      proposedStatusSummary: null,
      proposedBusinessNotes: null,
      proposedPersonalNotes: null,
      proposedNextBestAction: null,
      confidence: 'low',
      warnings: ['Η απάντηση AI δεν μπορεί να αναλυθεί.'],
    });
  });

  it('strips code fences, coerces fields, and defaults confidence to low', () => {
    const s = parseSuggestion(
      '```json\n{"proposedStatusSummary":"  σε εξέλιξη  ","proposedBusinessNotes":"","confidence":"weird","warnings":["α","",2]}\n```'
    );
    expect(s.proposedStatusSummary).toBe('σε εξέλιξη');
    expect(s.proposedBusinessNotes).toBeNull();
    expect(s.confidence).toBe('low');
    expect(s.warnings).toEqual(['α']);
  });
});

describe('buildMemoryPrompt (parity)', () => {
  it('renders the customer + memory blocks with empty-placeholders and the JSON schema', () => {
    const prompt = buildMemoryPrompt({
      businessName: 'ΑΦΟΙ',
      businessType: 'technical_services',
      customer: {
        id: 'c1', name: 'Γιώργος', company_name: null, status: 'new', source: null,
        needs_summary: null, status_summary: null, business_notes: null,
        personal_notes: null, next_best_action: null,
      },
      comms: [],
      tasks: [],
      offers: [],
      triggerEvent: null,
    });
    expect(prompt).toContain('Επιχείρηση: ΑΦΟΙ (technical_services)');
    expect(prompt).toContain('  Όνομα: Γιώργος');
    expect(prompt).toContain('  CRM κατάσταση: Νέος πελάτης');
    expect(prompt).toContain('  Τρέχουσα κατάσταση: (κενό)');
    expect(prompt).toContain('"confidence": "low" | "medium" | "high",');
  });
});

describe('runCustomerMemory (parity)', () => {
  const business = { id: 'b1', name: 'ΑΦΟΙ', type: 'technical_services' };

  it('customer_query_failed when the customer select errors', async () => {
    const supabase = fakeSupabase((t) => (t === 'customers' ? { error: { message: 'boom' } } : { data: null }));
    const out = await runCustomerMemory(supabase, 'key', business, { customerId: 'c1', triggerEvent: null });
    expect(out).toMatchObject({ ok: false, code: 'customer_query_failed', status: 500 });
  });

  it('customer_not_found when the customer row is missing', async () => {
    const supabase = fakeSupabase((t) => (t === 'customers' ? { data: null } : { data: null }));
    const out = await runCustomerMemory(supabase, 'key', business, { customerId: 'c1', triggerEvent: null });
    expect(out).toMatchObject({ ok: false, code: 'customer_not_found', status: 404 });
  });
});
