import { describe, it, expect } from 'vitest';
import { readWorkFolderId } from '../folder-link';

describe('folder-link', () => {
  describe('readWorkFolderId', () => {
    it('returns null for non-strings / empty / whitespace', () => {
      expect(readWorkFolderId(undefined)).toBeNull();
      expect(readWorkFolderId(null)).toBeNull();
      expect(readWorkFolderId(123)).toBeNull();
      expect(readWorkFolderId('')).toBeNull();
      expect(readWorkFolderId('   ')).toBeNull();
    });
    it('trims and returns a real id', () => {
      expect(readWorkFolderId('  abc-123  ')).toBe('abc-123');
    });
  });
});
