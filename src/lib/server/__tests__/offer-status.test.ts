import { describe, it, expect } from 'vitest';
import { offerCanRespond, isBeforeToday, athensToday, OFFER_FINAL_STATUSES } from '../offer-status';

describe('offer-status', () => {
  it('blocks responding to final statuses', () => {
    for (const status of OFFER_FINAL_STATUSES) {
      expect(offerCanRespond({ status, valid_until: null })).toBe(false);
    }
  });

  it('allows responding to non-final, non-expired offers', () => {
    expect(offerCanRespond({ status: 'sent_manually', valid_until: null })).toBe(true);
    expect(offerCanRespond({ status: 'draft', valid_until: '2999-12-31' })).toBe(true);
  });

  it('blocks responding to an expired offer (valid_until before today)', () => {
    expect(offerCanRespond({ status: 'sent_manually', valid_until: '2000-01-01' })).toBe(false);
  });

  it('isBeforeToday compares date-only', () => {
    expect(isBeforeToday('2000-01-01')).toBe(true);
    expect(isBeforeToday('2999-12-31')).toBe(false);
  });

  it('athensToday uses the Athens calendar day (DST-correct), not UTC', () => {
    // Summer (EEST, UTC+3): 22:30Z on the 19th is already 01:30 on the 20th in Athens.
    expect(athensToday(new Date('2026-06-19T22:30:00Z'))).toBe('2026-06-20');
    // Winter (EET, UTC+2): 23:30Z on the 19th is 01:30 on the 20th in Athens.
    expect(athensToday(new Date('2026-01-19T23:30:00Z'))).toBe('2026-01-20');
    // Mid-day is unambiguous.
    expect(athensToday(new Date('2026-06-19T09:00:00Z'))).toBe('2026-06-19');
  });
});
