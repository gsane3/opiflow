import { describe, it, expect } from 'vitest';
import { buildOfferCode } from '../offer-code';

describe('buildOfferCode', () => {
  it('transliterates Greek initials of customer + project', () => {
    // Γ→G, Μ→M, Ε→E, Κ→K
    expect(buildOfferCode('Γιάννης Μπεζός', 'Επισκευή Κλιματισμού')).toBe('GMEK');
  });

  it('handles accented initials (Ά→A)', () => {
    expect(buildOfferCode('Άννα Δήμου', null)).toBe('AD');
  });

  it('keeps Latin names and digits as-is', () => {
    expect(buildOfferCode('John Smith', 'AC Repair')).toBe('JSAR');
  });

  it('caps the code length', () => {
    expect(buildOfferCode('Α Β Γ Δ Ε Ζ Η Θ', null)).toBe('AVGDEZ');
  });

  it('returns empty string when there is nothing to derive from', () => {
    expect(buildOfferCode(null, null)).toBe('');
    expect(buildOfferCode('', '   ')).toBe('');
  });

  it('works with only one of the two inputs', () => {
    expect(buildOfferCode('Γιώργος Παπαδόπουλος', null)).toBe('GP');
    expect(buildOfferCode(null, 'Συντήρηση Λέβητα')).toBe('SL');
  });
});
