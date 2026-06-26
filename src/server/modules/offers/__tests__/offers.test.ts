import { describe, it, expect } from 'vitest';
import { CreateOfferScalarsSchema, ListOffersQuerySchema } from '../offers.schema';
import { dbToOffer, dbToOfferItem } from '../offers.service';
import type { OfferItemRow, OfferRow } from '../offers.types';

describe('CreateOfferScalarsSchema', () => {
  it('accepts an empty object (all scalars optional; items checked separately)', () => {
    expect(CreateOfferScalarsSchema.safeParse({}).success).toBe(true);
  });
  it('rejects an unknown status', () => {
    expect(CreateOfferScalarsSchema.safeParse({ status: 'paid' }).success).toBe(false);
  });
  it('rejects an out-of-range vatRate', () => {
    expect(CreateOfferScalarsSchema.safeParse({ vatRate: 150 }).success).toBe(false);
  });
  it('accepts a valid vatRate', () => {
    expect(CreateOfferScalarsSchema.safeParse({ vatRate: 24 }).success).toBe(true);
  });
});

describe('ListOffersQuerySchema', () => {
  it('defaults limit/offset', () => {
    const q = ListOffersQuerySchema.parse({});
    expect(q.limit).toBe(50);
    expect(q.offset).toBe(0);
  });
});

describe('dbToOffer / dbToOfferItem', () => {
  it('maps an offer + its items to the DTO', () => {
    const offer = {
      id: 'o1', business_id: 'b1', customer_id: 'c1', related_task_id: null, related_call_id: null,
      offer_number: 'OFFER-7-2026', status: 'draft', offer_date: '2026-06-01', valid_until: null,
      subtotal: 100, vat_rate: 24, vat_amount: 24, total: 124, notes: null, terms: null,
      acceptance_text: null, viber_draft: null, email_subject: null, email_body: null,
      created_from_ai: false, created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    } satisfies OfferRow;
    const item = {
      id: 'i1', business_id: 'b1', offer_id: 'o1', description: 'Εργασία', quantity: 1,
      unit_price: 100, line_total: 100, sort_order: 0,
      created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
    } satisfies OfferItemRow;

    const dto = dbToOffer(offer, [item]);
    expect(dto.offerNumber).toBe('OFFER-7-2026');
    expect(dto.vatRate).toBe(24);
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toEqual(dbToOfferItem(item));
    expect(dto.items[0].unitPrice).toBe(100);
  });
});
