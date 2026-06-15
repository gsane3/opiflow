// Suggested-action derivation (P5 plumbing).
//
// Turns an AI review result (the structured output of /api/ai/review) into a
// small, de-duplicated set of persistable "next action" chips for a customer.
// Pure + dependency-free so it is unit-testable and reusable from any AI path.
// The action_type values map 1:1 onto the suggested_actions CHECK constraint
// (migration 041).

export type SuggestedActionType =
  | 'send_offer'
  | 'book_appointment'
  | 'call_back'
  | 'request_photos'
  | 'request_details'
  | 'reminder';

export const SUGGESTED_ACTION_TYPES: SuggestedActionType[] = [
  'send_offer', 'book_appointment', 'call_back', 'request_photos', 'request_details', 'reminder',
];

export const SUGGESTED_ACTION_LABELS: Record<SuggestedActionType, string> = {
  send_offer: 'Δημιουργία προσφοράς',
  book_appointment: 'Κλείσε ραντεβού',
  call_back: 'Πάρε τηλέφωνο',
  request_photos: 'Ζήτα φωτογραφίες',
  request_details: 'Ζήτα στοιχεία',
  reminder: 'Υπενθύμιση',
};

export interface DerivedAction {
  actionType: SuggestedActionType;
  label: string;
  params: Record<string, unknown> | null;
}

// AI task type → suggested-action type. Unmapped task types (e.g. 'other') are
// intentionally dropped so they never become a chip.
const TASK_TYPE_TO_ACTION: Record<string, SuggestedActionType | undefined> = {
  send_offer: 'send_offer',
  follow_up_offer: 'send_offer',
  book_appointment: 'book_appointment',
  visit_customer: 'book_appointment',
  call_back: 'call_back',
  ask_for_photos_documents: 'request_photos',
  wait_for_reply: 'reminder',
  other: undefined,
};

/** Loose shape — we only read the fields we need and stay defensive. */
export interface LooseAiResult {
  tasks?: Array<{ type?: unknown } | null> | null;
  offer?: { shouldCreate?: unknown } | null;
  nextBestAction?: unknown;
}

export function isSuggestedActionType(v: unknown): v is SuggestedActionType {
  return typeof v === 'string' && (SUGGESTED_ACTION_TYPES as string[]).includes(v);
}

/**
 * Derive up to 5 de-duplicated suggested actions from an AI review result.
 * Order: an offer suggestion (if the AI wants one) first, then one per mapped
 * task type in task order. Labels are the canonical Greek labels.
 */
export function deriveSuggestedActions(ai: LooseAiResult | null | undefined): DerivedAction[] {
  const out: DerivedAction[] = [];
  const seen = new Set<SuggestedActionType>();

  function add(type: SuggestedActionType) {
    if (seen.has(type)) return;
    seen.add(type);
    out.push({ actionType: type, label: SUGGESTED_ACTION_LABELS[type], params: null });
  }

  if (ai?.offer && ai.offer.shouldCreate === true) add('send_offer');

  const tasks = Array.isArray(ai?.tasks) ? ai!.tasks! : [];
  for (const task of tasks) {
    const type = task && typeof task.type === 'string' ? TASK_TYPE_TO_ACTION[task.type] : undefined;
    if (type) add(type);
  }

  return out.slice(0, 5);
}

/** Accent- and case-insensitive Greek text for keyword matching. */
function foldGreek(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Keyword → action, evaluated in this order so the most "forward" actions
// (offer, appointment) surface before the catch-all call-back. Roots are stem
// fragments (no final-sigma / accent variance) matched on the folded text.
const BRIEF_KEYWORD_RULES: Array<{ type: SuggestedActionType; re: RegExp }> = [
  { type: 'send_offer', re: /προσφορ|προσφ\.|quote|κοστολογ/ },
  { type: 'book_appointment', re: /ραντεβ|επισκεψ|επισκεφ|αυτοψ|appointment/ },
  { type: 'request_photos', re: /φωτογραφ|φωτο |εικον|βιντεο/ },
  { type: 'request_details', re: /διευθυνσ|στοιχει|τιμολογ|αφμ|email|@/ },
  { type: 'call_back', re: /καλεσ|κλησ|τηλεφ|παρε τηλ|επικοινων|call ?back|follow ?up|επομεν/ },
];

/**
 * Derive up to 4 de-duplicated suggested actions purely from the TEXT of a call
 * brief — works without a structured AI result, so it covers calls to UNSAVED
 * numbers (no customer, no persisted suggested_actions). Used by the post-call
 * card to show one-tap "next task" chips.
 */
export function deriveActionsFromBriefText(text: string | null | undefined): DerivedAction[] {
  if (!text || !text.trim()) return [];
  const folded = foldGreek(text);
  const out: DerivedAction[] = [];
  const seen = new Set<SuggestedActionType>();
  for (const rule of BRIEF_KEYWORD_RULES) {
    if (seen.has(rule.type)) continue;
    if (rule.re.test(folded)) {
      seen.add(rule.type);
      out.push({ actionType: rule.type, label: SUGGESTED_ACTION_LABELS[rule.type], params: null });
    }
  }
  return out.slice(0, 4);
}
