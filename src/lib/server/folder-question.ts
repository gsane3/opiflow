// Pure helpers for the public folder question flow (WF-3).
//
// The customer, from the public /f/[token] page, sends a short free-text
// question about their job. These helpers validate/shape that text; the route
// (src/app/api/f/[token]/message/route.ts) does the token + DB work. Kept pure
// (no imports) so they are unit-testable without any DB or network.

export const MAX_QUESTION_LENGTH = 1000;

export type QuestionValidation =
  | { ok: true; message: string }
  | { ok: false; error: 'message_required' | 'message_too_long' };

/** Validate the customer's question: required, trimmed, sensible max length. */
export function validateQuestionMessage(raw: unknown): QuestionValidation {
  if (typeof raw !== 'string') return { ok: false, error: 'message_required' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: 'message_required' };
  if (trimmed.length > MAX_QUESTION_LENGTH) return { ok: false, error: 'message_too_long' };
  return { ok: true, message: trimmed };
}

/** Timeline summary line for the inbound communications row. */
export function buildFolderQuestionSummary(message: string): string {
  return `Ερώτηση από έργο: ${message}`;
}

export type FolderSentChannel = 'viber' | 'sms' | 'email' | 'manual' | null;
export type CommunicationChannel = 'viber' | 'sms' | 'email';

/**
 * Map the folder token's sent_channel onto a valid communications.channel.
 *
 * communications.channel CHECK (003) allows only call/sms/viber/email — NOT
 * 'manual'. So we pass through viber/sms/email and default manual/null to 'sms'.
 * This mirrors the appointment-response public flow's resolveChannel, keeping
 * the inbound question consistent with the other public response rows.
 */
export function resolveFolderChannel(sentChannel: FolderSentChannel): CommunicationChannel {
  if (sentChannel === 'viber' || sentChannel === 'sms' || sentChannel === 'email') {
    return sentChannel;
  }
  return 'sms';
}

/** Short, single-line preview of the message for the push notification body. */
export function buildQuestionPreview(message: string, max = 120): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
