import { describe, it, expect } from 'vitest';
import { looksLikeGreekMobile, selectViberPhone } from '../viber-phone';

describe('looksLikeGreekMobile', () => {
  it('accepts 10-digit 6… and 12-digit 306… mobiles, ignoring separators', () => {
    expect(looksLikeGreekMobile('6912345678')).toBe(true);
    expect(looksLikeGreekMobile('306912345678')).toBe(true);
    expect(looksLikeGreekMobile('+30 691 234 5678')).toBe(true);
    expect(looksLikeGreekMobile('69-12-34-56-78')).toBe(true);
  });

  it('rejects landlines, junk, 00-prefixed and empty values', () => {
    expect(looksLikeGreekMobile('2101234567')).toBe(false);
    expect(looksLikeGreekMobile('00306912345678')).toBe(false);
    expect(looksLikeGreekMobile('12345')).toBe(false);
    expect(looksLikeGreekMobile(null)).toBe(false);
    expect(looksLikeGreekMobile(undefined)).toBe(false);
    expect(looksLikeGreekMobile('')).toBe(false);
  });
});

describe('selectViberPhone', () => {
  it('prefers a present mobile_phone (returned verbatim)', () => {
    expect(selectViberPhone({ mobile_phone: '6912345678', phone: null })).toBe('6912345678');
    expect(selectViberPhone({ mobile_phone: '30 691 234 5678', phone: '2101234567' })).toBe('30 691 234 5678');
  });

  it('falls back to phone only when it looks like a Greek mobile', () => {
    expect(selectViberPhone({ mobile_phone: null, phone: '6912345678' })).toBe('6912345678');
    expect(selectViberPhone({ mobile_phone: '  ', phone: '6912345678' })).toBe('6912345678');
    expect(selectViberPhone({ mobile_phone: null, phone: '2101234567' })).toBeNull();
  });

  it('returns null when nothing usable is present', () => {
    expect(selectViberPhone({ mobile_phone: null, phone: null })).toBeNull();
    expect(selectViberPhone({})).toBeNull();
  });
});
