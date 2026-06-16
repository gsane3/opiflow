import { describe, it, expect, afterEach } from 'vitest';
import {
  hashFolderToken,
  generateRawFolderToken,
  buildFolderUrl,
  extractRawTokenFromFolderUrl,
} from '../folder-tokens';

describe('folder-tokens', () => {
  describe('hashFolderToken', () => {
    it('is a stable lowercase SHA-256 hex digest (locks the token format)', () => {
      expect(hashFolderToken('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
      expect(hashFolderToken('xyz')).toMatch(/^[0-9a-f]{64}$/);
    });
    it('is deterministic', () => {
      expect(hashFolderToken('t')).toBe(hashFolderToken('t'));
      expect(hashFolderToken('t')).not.toBe(hashFolderToken('u'));
    });
  });

  describe('generateRawFolderToken', () => {
    it('returns a 43-char base64url string', () => {
      const t = generateRawFolderToken();
      expect(t).toHaveLength(43);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    });
    it('is unique across calls', () => {
      expect(generateRawFolderToken()).not.toBe(generateRawFolderToken());
    });
  });

  describe('buildFolderUrl / extractRawTokenFromFolderUrl', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    afterEach(() => {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = prev;
    });

    it('builds an /f/<token> URL and round-trips back to the raw token', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
      const raw = generateRawFolderToken();
      const url = buildFolderUrl(raw);
      expect(url).toBe(`https://app.example/f/${raw}`); // base64url needs no encoding
      expect(extractRawTokenFromFolderUrl(url)).toBe(raw);
    });

    it('rejects URLs whose last segment is not a valid token', () => {
      expect(extractRawTokenFromFolderUrl('https://app.example/f/has space')).toBeNull();
      expect(extractRawTokenFromFolderUrl('not a url')).toBeNull();
      expect(extractRawTokenFromFolderUrl('https://app.example/f/')).toBeNull();
    });
  });
});
