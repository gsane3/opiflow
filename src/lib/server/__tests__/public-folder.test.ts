import { describe, it, expect } from 'vitest';
import {
  toPublicFolderView,
  folderStatusLabel,
  folderStatusMessage,
  type FolderRowForPublic,
  type BusinessRowForPublic,
  type OfferRowForPublic,
  type TaskRowForPublic,
} from '../public-folder';

const folder: FolderRowForPublic = { title: 'Τοποθέτηση κλιματιστικού', status: 'in_progress' };
const business: BusinessRowForPublic = {
  name: 'Acme', legal_name: 'Acme AE', trade_name: 'Acme Service',
  logo_url: 'https://x/logo.png', phone: '2101234567', email: 'a@b.gr', website: 'https://acme.gr',
};
const offers: OfferRowForPublic[] = [
  { id: 'off-1', offer_number: 'PR-1', status: 'sent_manually', total: 1200, valid_until: null },
  { id: 'off-2', offer_number: 'PR-2', status: 'draft', total: 0, valid_until: null },
];
const appts: TaskRowForPublic[] = [{ due_date: '2026-07-01', due_time: '10:00', type: 'book_appointment' }];

describe('public-folder', () => {
  describe('status helpers', () => {
    it('labels and messages the four statuses', () => {
      expect(folderStatusLabel('open')).toBe('Νέο');
      expect(folderStatusLabel('in_progress')).toBe('Σε εξέλιξη');
      expect(folderStatusLabel('done')).toBe('Ολοκληρώθηκε');
      expect(folderStatusLabel('archived')).toBe('Αρχειοθετήθηκε');
      expect(folderStatusMessage('in_progress')).toBe('Η εργασία είναι σε εξέλιξη.');
    });
  });

  describe('toPublicFolderView', () => {
    const view = toPublicFolderView(folder, business, offers, appts);

    it('maps the safe folder + business fields', () => {
      expect(view.title).toBe('Τοποθέτηση κλιματιστικού');
      expect(view.statusLabel).toBe('Σε εξέλιξη');
      expect(view.statusMessage).toBe('Η εργασία είναι σε εξέλιξη.');
      expect(view.business).toEqual({
        name: 'Acme Service', // trade_name wins
        logoUrl: 'https://x/logo.png',
        phone: '2101234567',
        email: 'a@b.gr',
        website: 'https://acme.gr',
      });
    });

    it('maps offers with customer-facing labels (draft → neutral)', () => {
      expect(view.offers).toEqual([
        { id: 'off-1', offerNumber: 'PR-1', statusLabel: 'Στάλθηκε', total: 1200, canAccept: true },
        { id: 'off-2', offerNumber: 'PR-2', statusLabel: 'Σε ετοιμασία', total: 0, canAccept: true },
      ]);
    });

    it('maps appointments to date/time/typeLabel only', () => {
      expect(view.appointments).toEqual([{ date: '2026-07-01', time: '10:00', typeLabel: 'Ραντεβού' }]);
    });

    it('NEVER leaks internal ids, internal notes, or business-only fields (security)', () => {
      const serialized = JSON.stringify(view);
      // NB: offer/appointment UUIDs ARE intentionally exposed (safe selectors for
      // the folder-scoped action endpoints — authorization is the folder token).
      // Internal scoping ids + notes must still never appear.
      for (const banned of ['business_id', 'customer_id', 'work_folder_id', 'token', 'owner_id', '"notes"']) {
        expect(serialized).not.toContain(banned);
      }
      // internal business notes are never part of the public view
      expect(view).not.toHaveProperty('notes');
      // the public view's top-level keys are an explicit allow-list
      expect(Object.keys(view).sort()).toEqual(
        ['appointments', 'business', 'offers', 'statusLabel', 'statusMessage', 'step', 'title'],
      );
    });

    it('drops the business when there is no name and no logo', () => {
      const v = toPublicFolderView(folder, { ...business, name: null, legal_name: null, trade_name: null, logo_url: null }, [], []);
      expect(v.business).toBeNull();
    });
  });
});
