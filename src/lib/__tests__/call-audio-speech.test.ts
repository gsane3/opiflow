import { describe, it, expect } from 'vitest';
import { countSpeechLetters } from '../server/openai-call-audio';

// Guards the «Χωρίς συνομιλία.» decision: it must be driven by whether the
// transcript contains real speech (letter count), NOT by the model's judgment
// about whether the call was "two-way". A substantial one-sided / single-speaker
// transcript (observed: a real 1016-char call) must NOT be treated as empty.
describe('countSpeechLetters', () => {
  it('returns 0 for empty / whitespace / punctuation-only transcripts', () => {
    expect(countSpeechLetters('')).toBe(0);
    expect(countSpeechLetters('   \n  \t ')).toBe(0);
    expect(countSpeechLetters('... --- !!! ;;; «»')).toBe(0);
  });

  it('ignores "Ομιλητής N:" diarization labels when counting', () => {
    // Only the labels, no real words → counts as no speech.
    expect(countSpeechLetters('Ομιλητής 1: \nΟμιλητής 2: ')).toBe(0);
  });

  it('counts Greek letters in real speech', () => {
    // "Καλημέρα" has 8 Greek letters (incl. accented η).
    expect(countSpeechLetters('Καλημέρα!')).toBe(8);
  });

  it('treats a substantial single-speaker transcript as real speech (regression)', () => {
    // Everything under one speaker label (Deepgram mono-mix diarization often
    // collapses to one speaker). This MUST be well above the empty threshold.
    const oneSided =
      'Ομιλητής 1: Γεια σας, σας πήρα για το θέμα με τον λέβητα που χάλασε χθες ' +
      'και ήθελα να κλείσω ένα ραντεβού για να έρθει κάποιος τεχνικός να το δει.';
    expect(countSpeechLetters(oneSided)).toBeGreaterThan(50);
  });

  it('counts Latin letters too (mixed transcripts)', () => {
    expect(countSpeechLetters('OK εντάξει')).toBe(2 + 7);
  });
});
