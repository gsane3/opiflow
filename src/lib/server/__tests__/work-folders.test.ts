import { describe, it, expect } from 'vitest';
import {
  isFolderStatus,
  validateFolderTitle,
  MAX_FOLDER_TITLE,
  dbToFolder,
  folderStatusRank,
  orderFolders,
  isAttachableEntityType,
  ATTACHABLE_ENTITIES,
  type WorkFolderRow,
} from '../work-folders';

describe('work-folders helpers', () => {
  describe('isFolderStatus', () => {
    it('accepts the four DB statuses', () => {
      for (const s of ['open', 'in_progress', 'done', 'archived']) {
        expect(isFolderStatus(s)).toBe(true);
      }
    });
    it('rejects anything else', () => {
      for (const s of ['new', 'OPEN', '', 'random', null, undefined, 1]) {
        expect(isFolderStatus(s)).toBe(false);
      }
    });
  });

  describe('validateFolderTitle', () => {
    it('trims and accepts a normal title', () => {
      expect(validateFolderTitle('  Τοποθέτηση κλιματιστικού  ')).toEqual({
        ok: true,
        value: 'Τοποθέτηση κλιματιστικού',
      });
    });
    it('rejects empty / whitespace / non-string as title_required', () => {
      for (const v of ['', '   ', null, undefined, 42, {}]) {
        expect(validateFolderTitle(v)).toEqual({ ok: false, error: 'title_required' });
      }
    });
    it('rejects > MAX_FOLDER_TITLE as title_too_long', () => {
      expect(validateFolderTitle('x'.repeat(MAX_FOLDER_TITLE + 1))).toEqual({
        ok: false,
        error: 'title_too_long',
      });
      // exactly the max is allowed
      expect(validateFolderTitle('x'.repeat(MAX_FOLDER_TITLE)).ok).toBe(true);
    });
  });

  describe('dbToFolder', () => {
    const row: WorkFolderRow = {
      id: 'f1',
      business_id: 'b1',
      customer_id: 'c1',
      title: 'Job',
      status: 'open',
      notes: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    it('maps snake_case row to camelCase folder', () => {
      expect(dbToFolder(row)).toEqual({
        id: 'f1',
        businessId: 'b1',
        customerId: 'c1',
        title: 'Job',
        status: 'open',
        step: 0,
        notes: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
      });
    });
    it('maps + clamps step (tolerant of a missing/out-of-range column)', () => {
      expect(dbToFolder({ ...row, step: 3 }).step).toBe(3);
      expect(dbToFolder({ ...row, step: undefined }).step).toBe(0); // pre-047 row
      expect(dbToFolder({ ...row, step: null }).step).toBe(0);
      expect(dbToFolder({ ...row, step: 9 }).step).toBe(4); // clamped to MAX
      expect(dbToFolder({ ...row, step: -2 }).step).toBe(0);
    });
    it('includes counts only when provided', () => {
      const counts = { offers: 2, appointments: 1, messages: 3, uploadRequests: 0, intakeRequests: 1 };
      expect(dbToFolder(row, counts).counts).toEqual(counts);
      expect(dbToFolder(row).counts).toBeUndefined();
    });
  });

  describe('ordering', () => {
    it('ranks active (open/in_progress) before inactive (done/archived)', () => {
      expect(folderStatusRank('open')).toBeLessThan(folderStatusRank('in_progress'));
      expect(folderStatusRank('in_progress')).toBeLessThan(folderStatusRank('done'));
      expect(folderStatusRank('done')).toBeLessThan(folderStatusRank('archived'));
      expect(folderStatusRank('weird')).toBe(99);
    });
    it('orders active first, then newest-first within a rank', () => {
      const input = [
        { id: 'a', status: 'done', createdAt: '2026-03-01T00:00:00Z' },
        { id: 'b', status: 'open', createdAt: '2026-01-01T00:00:00Z' },
        { id: 'c', status: 'open', createdAt: '2026-02-01T00:00:00Z' },
        { id: 'd', status: 'archived', createdAt: '2026-04-01T00:00:00Z' },
      ];
      expect(orderFolders(input).map((f) => f.id)).toEqual(['c', 'b', 'a', 'd']);
    });
    it('does not mutate the input array', () => {
      const input = [
        { id: 'a', status: 'done', createdAt: '2026-03-01T00:00:00Z' },
        { id: 'b', status: 'open', createdAt: '2026-01-01T00:00:00Z' },
      ];
      const before = input.map((f) => f.id);
      orderFolders(input);
      expect(input.map((f) => f.id)).toEqual(before);
    });
  });

  describe('isAttachableEntityType', () => {
    it('accepts the five attachable types and maps them to tables', () => {
      expect(Object.keys(ATTACHABLE_ENTITIES).sort()).toEqual(
        ['communication', 'intake_token', 'offer', 'task', 'upload_token'],
      );
      for (const t of Object.keys(ATTACHABLE_ENTITIES)) {
        expect(isAttachableEntityType(t)).toBe(true);
      }
      expect(ATTACHABLE_ENTITIES.offer).toBe('offers');
      expect(ATTACHABLE_ENTITIES.upload_token).toBe('customer_upload_tokens');
    });
    it('rejects unknown / unsafe types', () => {
      for (const t of ['customer', 'business', 'toString', '', null, undefined, 5]) {
        expect(isAttachableEntityType(t)).toBe(false);
      }
    });
  });
});
