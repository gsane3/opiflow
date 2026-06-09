import { describe, it, expect } from 'vitest';
import { deriveSuggestedActions, isSuggestedActionType } from '../server/suggested-actions';

describe('deriveSuggestedActions', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(deriveSuggestedActions(null)).toEqual([]);
    expect(deriveSuggestedActions(undefined)).toEqual([]);
    expect(deriveSuggestedActions({})).toEqual([]);
  });

  it('suggests send_offer when the AI wants to create an offer', () => {
    expect(deriveSuggestedActions({ offer: { shouldCreate: true } })).toEqual([
      { actionType: 'send_offer', label: 'Δημιουργία προσφοράς', params: null },
    ]);
  });

  it('does not suggest send_offer when shouldCreate is false/missing', () => {
    expect(deriveSuggestedActions({ offer: { shouldCreate: false } })).toEqual([]);
    expect(deriveSuggestedActions({ offer: {} })).toEqual([]);
  });

  it('maps task types to action types in order', () => {
    const r = deriveSuggestedActions({
      tasks: [{ type: 'book_appointment' }, { type: 'call_back' }, { type: 'ask_for_photos_documents' }],
    });
    expect(r.map((a) => a.actionType)).toEqual(['book_appointment', 'call_back', 'request_photos']);
  });

  it('de-duplicates across offer + tasks (offer first)', () => {
    const r = deriveSuggestedActions({
      offer: { shouldCreate: true },
      tasks: [{ type: 'send_offer' }, { type: 'follow_up_offer' }, { type: 'book_appointment' }],
    });
    expect(r.map((a) => a.actionType)).toEqual(['send_offer', 'book_appointment']);
  });

  it("drops unmapped task types ('other', unknown, non-string)", () => {
    const r = deriveSuggestedActions({
      tasks: [{ type: 'other' }, { type: 'totally_unknown' }, { type: 42 }, null],
    });
    expect(r).toEqual([]);
  });

  it('caps at 5 actions', () => {
    const r = deriveSuggestedActions({
      offer: { shouldCreate: true },
      tasks: [
        { type: 'book_appointment' }, { type: 'call_back' },
        { type: 'ask_for_photos_documents' }, { type: 'wait_for_reply' },
        { type: 'visit_customer' },
      ],
    });
    expect(r.length).toBeLessThanOrEqual(5);
  });
});

describe('isSuggestedActionType', () => {
  it('accepts valid types and rejects others', () => {
    expect(isSuggestedActionType('send_offer')).toBe(true);
    expect(isSuggestedActionType('book_appointment')).toBe(true);
    expect(isSuggestedActionType('nope')).toBe(false);
    expect(isSuggestedActionType(123)).toBe(false);
    expect(isSuggestedActionType(null)).toBe(false);
  });
});
