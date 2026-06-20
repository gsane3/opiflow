// Server-only helper for call summaries.
//
// IMPORTANT (owner requirement): the AI must describe ONLY what was actually
// said, based on a real transcript. A "metadata-only" brief (guessing call
// content from dialstatus / customer-match) caused hallucinations — e.g. a
// MISSED call being summarised as "called to cancel a scheduled visit" although
// no conversation ever happened. So this metadata brief is DISABLED: it always
// returns null and callers fall back to a plain, factual label ("Αναπάντητη
// κλήση" / "Κλήση — γίνεται επεξεργασία…"). The only AI brief shown is the
// transcript brief (src/lib/server/openai-call-audio.ts), generated from the
// actual recording.

export interface CallBriefInput {
  callerNumber: string | null;
  dialStatus: string | null;
  uniqueId: string | null;
  recordingExists: boolean | null;
  recordingSizeBytes: number | null;
  recordingFallbackApplied: boolean | null;
  customerCreated: boolean;
  customerMatched: boolean;
  intakeUrlCreated: boolean;
  viberSendStatus: string | null;
  /** Call direction; kept for caller compatibility. */
  direction?: 'inbound' | 'outbound';
}

// Always null — no speculative metadata brief is ever produced. (async kept so
// existing `await generateCallBrief(...)` call sites are unchanged.)
export async function generateCallBrief(_input: CallBriefInput): Promise<string | null> {
  return null;
}
