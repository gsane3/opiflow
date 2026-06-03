import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  phonesMatch,
  findCustomerByPhone,
  getCustomerPhoneKeys,
  findDuplicateCustomerGroups,
  isLikelyMobile,
  getSmsPhone,
  getMobilePhone,
  getLandlinePhone,
  getCallPhone,
} from '../phone';
import type { Customer } from '../types';

// Minimal Customer factory — only the fields these functions read matter.
function cust(partial: Partial<Customer> & { id: string }): Customer {
  return partial as Customer;
}

describe('normalizePhone', () => {
  it('strips spaces, dashes, parens, dots and a leading +', () => {
    expect(normalizePhone('+30 (210) 123-4567')).toBe('2101234567');
    expect(normalizePhone('210.123.4567')).toBe('2101234567');
  });

  it('removes a 0030 international prefix', () => {
    expect(normalizePhone('00306912345678')).toBe('6912345678');
  });

  it('removes a leading 30 country code only when longer than 10 digits', () => {
    expect(normalizePhone('306912345678')).toBe('6912345678');
  });

  it('keeps a leading 30 when the number is exactly 10 digits (local number)', () => {
    // '3012345678' is 10 chars, so the >10 guard does not strip the 30.
    expect(normalizePhone('3012345678')).toBe('3012345678');
  });

  it('leaves an already-normalized mobile untouched', () => {
    expect(normalizePhone('6912345678')).toBe('6912345678');
  });

  it('handles +30 prefixed mobile producing a 10-digit national number', () => {
    expect(normalizePhone('+306912345678')).toBe('6912345678');
  });
});

describe('phonesMatch', () => {
  it('returns false when either side is missing', () => {
    expect(phonesMatch(undefined, '6912345678')).toBe(false);
    expect(phonesMatch('6912345678', undefined)).toBe(false);
    expect(phonesMatch('', '6912345678')).toBe(false);
  });

  it('matches the same number written in different formats', () => {
    expect(phonesMatch('+30 691 234 5678', '00306912345678')).toBe(true);
    expect(phonesMatch('(210) 123-4567', '210.123.4567')).toBe(true);
  });

  it('does not match different numbers', () => {
    expect(phonesMatch('6912345678', '6900000000')).toBe(false);
  });
});

describe('isLikelyMobile', () => {
  it('accepts Greek mobiles in various prefixes', () => {
    expect(isLikelyMobile('6912345678')).toBe(true);
    expect(isLikelyMobile('06912345678')).toBe(true);
    expect(isLikelyMobile('306912345678')).toBe(true);
    expect(isLikelyMobile('00306912345678')).toBe(true);
  });

  it('accepts a +-prefixed / spaced mobile', () => {
    expect(isLikelyMobile('+30 691 234 5678')).toBe(true);
  });

  it('rejects landlines and obvious non-mobiles', () => {
    expect(isLikelyMobile('2101234567')).toBe(false);
    expect(isLikelyMobile('')).toBe(false);
    expect(isLikelyMobile('1234567890')).toBe(false);
  });

  it('rejects a 69-number with too many trailing digits', () => {
    // 0030 + 69 + 9 digits exceeds the 7-8 digit local part.
    expect(isLikelyMobile('003069123456789')).toBe(false);
  });
});

describe('getSmsPhone / getMobilePhone', () => {
  it('prefers an explicit mobilePhone field', () => {
    expect(getSmsPhone({ mobilePhone: ' 6912345678 ', phone: '2101234567' })).toBe('6912345678');
  });

  it('falls back to phone only when it looks like a mobile', () => {
    expect(getSmsPhone({ phone: '6912345678' })).toBe('6912345678');
    expect(getSmsPhone({ phone: '2101234567' })).toBeNull();
  });

  it('returns null when nothing usable is present', () => {
    expect(getSmsPhone({})).toBeNull();
  });

  it('getMobilePhone is an alias of getSmsPhone', () => {
    expect(getMobilePhone({ mobilePhone: '6912345678' })).toBe('6912345678');
  });
});

describe('getLandlinePhone', () => {
  it('prefers an explicit landlinePhone field', () => {
    expect(getLandlinePhone({ landlinePhone: ' 2101234567 ', phone: '6912345678' })).toBe('2101234567');
  });

  it('falls back to phone only when it does NOT look like a mobile', () => {
    expect(getLandlinePhone({ phone: '2101234567' })).toBe('2101234567');
    expect(getLandlinePhone({ phone: '6912345678' })).toBeNull();
  });

  it('returns null when nothing usable is present', () => {
    expect(getLandlinePhone({})).toBeNull();
  });
});

describe('getCallPhone', () => {
  it('prefers mobile, then landline, then generic phone', () => {
    expect(
      getCallPhone({ mobilePhone: '6912345678', landlinePhone: '2101234567', phone: '2109999999' })
    ).toBe('6912345678');
    expect(getCallPhone({ landlinePhone: '2101234567', phone: '2109999999' })).toBe('2101234567');
    expect(getCallPhone({ phone: '2109999999' })).toBe('2109999999');
  });

  it('returns null when no phone fields are set', () => {
    expect(getCallPhone({})).toBeNull();
  });
});

describe('getCustomerPhoneKeys', () => {
  it('returns normalized, de-duplicated keys across all phone fields', () => {
    const c = cust({
      id: '1',
      mobilePhone: '+30 691 234 5678',
      landlinePhone: '210-123-4567',
      phone: '00306912345678', // same as mobile after normalization
    });
    const keys = getCustomerPhoneKeys(c);
    expect(keys).toContain('6912345678');
    expect(keys).toContain('2101234567');
    // mobile and phone collapse to the same key -> only two unique keys.
    expect(keys).toHaveLength(2);
  });

  it('returns an empty array when no phones are present', () => {
    expect(getCustomerPhoneKeys(cust({ id: '1' }))).toEqual([]);
  });
});

describe('findCustomerByPhone', () => {
  const customers = [
    cust({ id: 'a', mobilePhone: '6912345678' }),
    cust({ id: 'b', landlinePhone: '2101234567' }),
    cust({ id: 'c', phone: '6900000000' }),
  ];

  it('finds by mobile, landline or generic phone, format-insensitively', () => {
    expect(findCustomerByPhone(customers, '+30 691 234 5678')?.id).toBe('a');
    expect(findCustomerByPhone(customers, '210.123.4567')?.id).toBe('b');
    expect(findCustomerByPhone(customers, '6900000000')?.id).toBe('c');
  });

  it('returns undefined for blank input or no match', () => {
    expect(findCustomerByPhone(customers, '   ')).toBeUndefined();
    expect(findCustomerByPhone(customers, '2105555555')).toBeUndefined();
  });
});

describe('findDuplicateCustomerGroups', () => {
  it('groups customers sharing a normalized phone key', () => {
    const customers = [
      cust({ id: '1', mobilePhone: '6912345678' }),
      cust({ id: '2', phone: '+30 691 234 5678' }), // same number, different format
      cust({ id: '3', mobilePhone: '6900000000' }), // unique
    ];
    const groups = findDuplicateCustomerGroups(customers);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((c) => c.id).sort()).toEqual(['1', '2']);
  });

  it('returns no groups when every customer is unique', () => {
    const customers = [
      cust({ id: '1', mobilePhone: '6912345678' }),
      cust({ id: '2', mobilePhone: '6900000000' }),
    ];
    expect(findDuplicateCustomerGroups(customers)).toEqual([]);
  });
});
