import { describe, it, expect } from 'vitest';
import {
  validateQuestionMessage,
  buildFolderQuestionSummary,
  resolveFolderChannel,
  buildQuestionPreview,
  MAX_QUESTION_LENGTH,
} from '../folder-question';

describe('folder-question', () => {
  describe('validateQuestionMessage', () => {
    it('rejects non-strings', () => {
      expect(validateQuestionMessage(undefined)).toEqual({ ok: false, error: 'message_required' });
      expect(validateQuestionMessage(null)).toEqual({ ok: false, error: 'message_required' });
      expect(validateQuestionMessage(123)).toEqual({ ok: false, error: 'message_required' });
      expect(validateQuestionMessage({})).toEqual({ ok: false, error: 'message_required' });
    });
    it('rejects empty / whitespace-only', () => {
      expect(validateQuestionMessage('')).toEqual({ ok: false, error: 'message_required' });
      expect(validateQuestionMessage('   \n\t ')).toEqual({ ok: false, error: 'message_required' });
    });
    it('trims and accepts a normal message', () => {
      expect(validateQuestionMessage('  Γεια σας  ')).toEqual({ ok: true, message: 'Γεια σας' });
    });
    it('rejects messages longer than the max (after trim)', () => {
      const long = 'α'.repeat(MAX_QUESTION_LENGTH + 1);
      expect(validateQuestionMessage(long)).toEqual({ ok: false, error: 'message_too_long' });
    });
    it('accepts a message exactly at the max', () => {
      const exact = 'α'.repeat(MAX_QUESTION_LENGTH);
      const result = validateQuestionMessage(exact);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.message).toHaveLength(MAX_QUESTION_LENGTH);
    });
    it('counts length AFTER trimming (surrounding space does not push over the limit)', () => {
      const exact = `  ${'α'.repeat(MAX_QUESTION_LENGTH)}  `;
      expect(validateQuestionMessage(exact)).toEqual({
        ok: true,
        message: 'α'.repeat(MAX_QUESTION_LENGTH),
      });
    });
  });

  describe('buildFolderQuestionSummary', () => {
    it('prefixes the Greek folder-question label', () => {
      expect(buildFolderQuestionSummary('Πότε θα έρθετε;')).toBe(
        'Ερώτηση από φάκελο: Πότε θα έρθετε;',
      );
    });
  });

  describe('resolveFolderChannel', () => {
    it('passes through the channels communications.channel allows', () => {
      expect(resolveFolderChannel('viber')).toBe('viber');
      expect(resolveFolderChannel('sms')).toBe('sms');
      expect(resolveFolderChannel('email')).toBe('email');
    });
    it('defaults manual/null to sms (manual is NOT a valid communications channel)', () => {
      expect(resolveFolderChannel('manual')).toBe('sms');
      expect(resolveFolderChannel(null)).toBe('sms');
    });
  });

  describe('buildQuestionPreview', () => {
    it('collapses whitespace to a single line', () => {
      expect(buildQuestionPreview('a\n  b   c')).toBe('a b c');
    });
    it('truncates long messages with an ellipsis to the max length', () => {
      const long = 'x'.repeat(200);
      const preview = buildQuestionPreview(long, 120);
      expect(preview).toHaveLength(120);
      expect(preview.endsWith('…')).toBe(true);
    });
    it('leaves short messages untouched', () => {
      expect(buildQuestionPreview('Σύντομο', 120)).toBe('Σύντομο');
    });
  });
});
