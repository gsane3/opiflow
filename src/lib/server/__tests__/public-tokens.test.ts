import { describe, it, expect, afterEach } from 'vitest';
import { generateRawToken, hashToken, buildPublicTokenUrl, getPublicAppUrl } from '../public-tokens';

describe('public-tokens', () => {
  describe('hashToken', () => {
    it('is a stable lowercase SHA-256 hex digest', () => {
      // Known SHA-256("abc") vector — this LOCKS the token-hash format. If it
      // ever changes, every live public link would stop validating.
      expect(hashToken('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
      expect(hashToken('any-raw-token')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic for the same input', () => {
      expect(hashToken('x')).toBe(hashToken('x'));
      expect(hashToken('x')).not.toBe(hashToken('y'));
    });
  });

  describe('generateRawToken', () => {
    it('returns a 43-char base64url string (32 random bytes, no padding)', () => {
      const t = generateRawToken();
      expect(t).toHaveLength(43);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('is unique across calls', () => {
      expect(generateRawToken()).not.toBe(generateRawToken());
    });
  });

  describe('getPublicAppUrl / buildPublicTokenUrl', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    afterEach(() => {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
    });

    it('strips a trailing slash from NEXT_PUBLIC_APP_URL', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example/';
      expect(getPublicAppUrl()).toBe('https://app.example');
    });

    it('builds ${origin}/${segment}/${token}', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
      expect(buildPublicTokenUrl('intake', 'tok')).toBe('https://app.example/intake/tok');
      expect(buildPublicTokenUrl('offer-response', 'tok')).toBe(
        'https://app.example/offer-response/tok',
      );
    });

    it('URL-encodes the raw token', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
      expect(buildPublicTokenUrl('upload', 'a b/c+d')).toBe(
        'https://app.example/upload/a%20b%2Fc%2Bd',
      );
    });
  });
});
