import { describe, it, expect } from 'vitest';
import { parseAiResponse } from '../ai/schema';

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

describe('parseAiResponse — empty / invalid input', () => {
  it('returns a fully-defaulted result for undefined', () => {
    const r = parseAiResponse(undefined);
    expect(r.customer).toEqual({
      name: '',
      phone: '',
      email: '',
      source: 'inbound_call',
      opportunityValue: 0,
      preferredContactMethod: 'phone',
    });
    expect(r.summary).toBe('');
    expect(r.customerNeeds).toBe('');
    expect(r.tasks).toEqual([]);
    expect(r.offer).toEqual({ shouldCreate: false, items: [], notes: '', terms: '' });
    expect(r.statusUpdate).toBe('in_progress');
    expect(r.nextBestAction).toBe('');
    expect(r.warnings).toEqual([]);
  });

  it('treats null, arrays and primitives as an empty object', () => {
    for (const input of [null, [], 'string', 42, true]) {
      const r = parseAiResponse(input);
      expect(r.tasks).toEqual([]);
      expect(r.offer.items).toEqual([]);
      expect(r.statusUpdate).toBe('in_progress');
    }
  });
});

describe('parseAiResponse — enum fallback', () => {
  it('falls back to defaults for invalid enum values', () => {
    const r = parseAiResponse({
      customer: { source: 'tiktok_ads', preferredContactMethod: 'carrier_pigeon' },
      statusUpdate: 'ghosted',
    });
    expect(r.customer.source).toBe('inbound_call');
    expect(r.customer.preferredContactMethod).toBe('phone');
    expect(r.statusUpdate).toBe('in_progress');
  });

  it('preserves valid enum values', () => {
    const r = parseAiResponse({
      customer: { source: 'google_ads', preferredContactMethod: 'email' },
      statusUpdate: 'won',
    });
    expect(r.customer.source).toBe('google_ads');
    expect(r.customer.preferredContactMethod).toBe('email');
    expect(r.statusUpdate).toBe('won');
  });
});

describe('parseAiResponse — customer field coercion', () => {
  it('coerces non-string names/emails to empty string', () => {
    const r = parseAiResponse({ customer: { name: 123, email: null, phone: {} } });
    expect(r.customer.name).toBe('');
    expect(r.customer.email).toBe('');
    expect(r.customer.phone).toBe('');
  });

  it('clamps a negative opportunityValue to 0 and rejects non-finite numbers', () => {
    expect(parseAiResponse({ customer: { opportunityValue: -500 } }).customer.opportunityValue).toBe(0);
    expect(parseAiResponse({ customer: { opportunityValue: Infinity } }).customer.opportunityValue).toBe(0);
    expect(parseAiResponse({ customer: { opportunityValue: NaN } }).customer.opportunityValue).toBe(0);
  });

  it('keeps a valid positive opportunityValue', () => {
    expect(parseAiResponse({ customer: { opportunityValue: 1500 } }).customer.opportunityValue).toBe(1500);
  });
});

describe('parseAiResponse — tasks', () => {
  it('filters out tasks with empty/whitespace titles', () => {
    const r = parseAiResponse({
      tasks: [
        { title: 'Call back' },
        { title: '   ' },
        { title: '' },
        {},
      ],
    });
    expect(r.tasks).toHaveLength(1);
    expect(r.tasks[0].title).toBe('Call back');
  });

  it('clamps the number of tasks to 5', () => {
    const r = parseAiResponse({
      tasks: Array.from({ length: 8 }, (_, i) => ({ title: `Task ${i}` })),
    });
    expect(r.tasks).toHaveLength(5);
    expect(r.tasks[4].title).toBe('Task 4');
  });

  it('applies type/priority enum fallbacks per task', () => {
    const r = parseAiResponse({
      tasks: [{ title: 'X', type: 'nope', priority: 'urgent' }],
    });
    expect(r.tasks[0].type).toBe('other');
    expect(r.tasks[0].priority).toBe('normal');
  });

  it('preserves valid task type and priority', () => {
    const r = parseAiResponse({
      tasks: [{ title: 'X', type: 'send_offer', priority: 'high' }],
    });
    expect(r.tasks[0].type).toBe('send_offer');
    expect(r.tasks[0].priority).toBe('high');
  });

  it('keeps a well-formed dueDate but defaults a malformed one to tomorrow', () => {
    const r = parseAiResponse({
      tasks: [
        { title: 'good', dueDate: '2026-12-31' },
        { title: 'bad', dueDate: '31/12/2026' },
        { title: 'missing' },
      ],
    });
    expect(r.tasks[0].dueDate).toBe('2026-12-31');
    expect(r.tasks[1].dueDate).toBe(tomorrowStr());
    expect(r.tasks[2].dueDate).toBe(tomorrowStr());
  });
});

describe('parseAiResponse — offer', () => {
  it('filters out items with empty descriptions', () => {
    const r = parseAiResponse({
      offer: {
        items: [
          { description: 'Labor', quantity: 2, unitPrice: 50 },
          { description: '   ', quantity: 1, unitPrice: 10 },
          {},
        ],
      },
    });
    expect(r.offer.items).toHaveLength(1);
    expect(r.offer.items[0].description).toBe('Labor');
  });

  it('clamps the number of offer items to 10', () => {
    const r = parseAiResponse({
      offer: {
        items: Array.from({ length: 15 }, (_, i) => ({
          description: `Item ${i}`,
          quantity: 1,
          unitPrice: 1,
        })),
      },
    });
    expect(r.offer.items).toHaveLength(10);
  });

  it('clamps quantity to a 0.5 minimum and unitPrice to a 0 minimum', () => {
    const r = parseAiResponse({
      offer: {
        items: [{ description: 'A', quantity: 0, unitPrice: -10 }],
      },
    });
    expect(r.offer.items[0].quantity).toBe(0.5);
    expect(r.offer.items[0].unitPrice).toBe(0);
  });

  it('defaults quantity to 1 and unitPrice to 0 when not numbers', () => {
    const r = parseAiResponse({
      offer: { items: [{ description: 'A', quantity: 'two', unitPrice: null }] },
    });
    expect(r.offer.items[0].quantity).toBe(1);
    expect(r.offer.items[0].unitPrice).toBe(0);
  });

  it('infers shouldCreate=true from non-empty items when not explicitly set', () => {
    const r = parseAiResponse({
      offer: { items: [{ description: 'A', quantity: 1, unitPrice: 5 }] },
    });
    expect(r.offer.shouldCreate).toBe(true);
  });

  it('infers shouldCreate=false when there are no valid items', () => {
    const r = parseAiResponse({ offer: { items: [] } });
    expect(r.offer.shouldCreate).toBe(false);
  });

  it('respects an explicit boolean shouldCreate over inference', () => {
    const withItems = parseAiResponse({
      offer: { shouldCreate: false, items: [{ description: 'A', quantity: 1, unitPrice: 5 }] },
    });
    expect(withItems.offer.shouldCreate).toBe(false);

    const withoutItems = parseAiResponse({ offer: { shouldCreate: true, items: [] } });
    expect(withoutItems.offer.shouldCreate).toBe(true);
  });
});

describe('parseAiResponse — warnings', () => {
  it('keeps only string warnings and clamps to 5', () => {
    const r = parseAiResponse({
      warnings: ['a', 1, 'b', null, 'c', 'd', 'e', 'f', {}],
    });
    expect(r.warnings).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('defaults to an empty array when warnings is not an array', () => {
    expect(parseAiResponse({ warnings: 'oops' }).warnings).toEqual([]);
  });
});

describe('parseAiResponse — passthrough text fields', () => {
  it('passes through summary, customerNeeds and nextBestAction strings', () => {
    const r = parseAiResponse({
      summary: 'A summary',
      customerNeeds: 'Needs a new roof',
      nextBestAction: 'Send the offer',
    });
    expect(r.summary).toBe('A summary');
    expect(r.customerNeeds).toBe('Needs a new roof');
    expect(r.nextBestAction).toBe('Send the offer');
  });
});
