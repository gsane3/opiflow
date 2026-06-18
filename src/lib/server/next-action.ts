// Next Best Action — the deterministic CAM ranker (v1).
//
// Opiflow shows the technician exactly ONE recommended action per work folder
// (or per customer when no folder exists yet) — never a list. The ranking is
// DETERMINISTIC (priority rules first); the LLM is intentionally NOT in the loop
// for v1 — the title/explanation are fixed Greek templates that NEVER echo raw
// transcript or call-brief text. Pure + dependency-free so it is fully unit-
// testable and reused from the API routes and (later) the call webhook.
//
// Persistence + DB reads live in next-action-store.ts. This file is the brain:
//   rankNextAction()       — signals → one ranked action (the priority rules)
//   describeNextAction()   — action + signals → Greek title/explanation
//   reconcileNextAction()  — candidate + existing rows → what to show/persist
//   toClientAction()       — DB row → safe client shape (no internal fields)

// ---------------------------------------------------------------------------
// Action types + Greek copy (the only customer-action verbs v1 supports).
// ---------------------------------------------------------------------------

export type NextActionType =
  | 'create_work_folder'
  | 'share_folder_link'
  | 'request_photos'
  | 'request_customer_details'
  | 'create_offer'
  | 'schedule_appointment'
  | 'send_follow_up'
  | 'reply_to_customer'
  | 'mark_work_done'
  | 'no_action';

export const NEXT_ACTION_TYPES: NextActionType[] = [
  'create_work_folder', 'share_folder_link', 'request_photos', 'request_customer_details',
  'create_offer', 'schedule_appointment', 'send_follow_up', 'reply_to_customer',
  'mark_work_done', 'no_action',
];

export function isNextActionType(v: unknown): v is NextActionType {
  return typeof v === 'string' && (NEXT_ACTION_TYPES as string[]).includes(v);
}

// Short action label (the prominent line under the «Προτεινόμενη ενέργεια» header).
export const NEXT_ACTION_LABELS: Record<NextActionType, string> = {
  create_work_folder: 'Δημιουργία φακέλου',
  share_folder_link: 'Στείλε το link στον πελάτη',
  request_photos: 'Ζήτα φωτογραφίες',
  request_customer_details: 'Ζήτα στοιχεία',
  create_offer: 'Δημιουργία προσφοράς',
  schedule_appointment: 'Κλείσε ραντεβού',
  send_follow_up: 'Κάνε follow-up',
  reply_to_customer: 'Απάντησε στον πελάτη',
  mark_work_done: 'Ολοκλήρωση εργασίας',
  no_action: '',
};

export type NextActionStatus =
  | 'pending' | 'accepted' | 'dismissed' | 'snoozed' | 'completed' | 'superseded';

// ---------------------------------------------------------------------------
// Signals — the deterministic inputs. All booleans default to false/undefined so
// callers (and tests) only set what they know. `briefText` is internal (used for
// keyword detection ONLY); it never reaches the client or the persisted title.
// ---------------------------------------------------------------------------

export interface NextActionSignals {
  scope: 'folder' | 'customer';
  nowMs: number;

  // folder lifecycle
  folderStatus?: string | null;     // open | in_progress | done | archived
  linkSent?: boolean;               // the folder portal link was delivered

  // offers
  hasOffer?: boolean;               // an active (non-rejected) offer exists
  offerAccepted?: boolean;          // an offer was accepted
  offerSentAwaitingOver48h?: boolean; // an offer was sent ≥48h ago, still no answer

  // customer-supplied inputs
  uploadCompleted?: boolean;        // customer uploaded photos/files
  intakeSubmitted?: boolean;        // customer submitted their details
  photosRequestPending?: boolean;   // a photo request is out, not completed
  detailsRequestPending?: boolean;  // a details request is out, not submitted

  // scheduling + messaging
  appointmentScheduled?: boolean;   // an appointment already exists
  inboundUnanswered?: boolean;      // the last message is an inbound customer message

  // completion
  workLooksComplete?: boolean;      // payment confirmed (or accepted offer + done appt)

  // call brief (internal text — keyword-matched, never surfaced)
  briefText?: string | null;

  // activity
  lastActivityAtMs?: number | null;
}

export interface RankedNextAction {
  actionType: NextActionType;
  priority: number;       // lower = higher priority
  confidence: number;     // 0..1
  sourceEventType: string | null;
}

// ---------------------------------------------------------------------------
// Greek brief keyword detection. Accent/case-folded; roots only (stem fragments).
// Mirrors the spirit of suggested-actions.ts so the two stay consistent.
// ---------------------------------------------------------------------------

function foldGreek(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const RE_QUOTE = /προσφορ|κοστολογ|κοστο|τιμη|τιμες|προυπολογ|quote|estimate/;
const RE_PHOTOS = /φωτογραφ|φωτο|εικον|βιντεο/;
const RE_DETAILS = /διευθυνσ|στοιχει|αφμ|τιμολογ|email|@|δικαιολογ|εγγραφ/;
// NB: bare `μερα`/`ωρα` are intentionally NOT here — they false-positive on
// «καλημέρα», «σήμερα», «ωραία», «ωραίο». Only ραντεβού/επίσκεψη/αυτοψία roots,
// «ημερομην» and explicit visit-intent phrases count as an appointment signal.
const RE_APPOINTMENT = /ραντεβ|επισκεψ|επισκεφ|αυτοψ|ημερομην|appointment|visit|να περασω|θα περασω|να ερθω|θα ερθω/;
const RE_CALLBACK = /θα σε παρω|θα σας παρω|callback|call ?back|ξαναπαρ|επανερχ|να με παρ/;
const RE_JOB = /δουλει|εργασ|τοποθετ|επισκευ|συντηρ|εγκατασ|βλαβ|προβλημα|αλλαγη|μετρηση/;

interface BriefFlags {
  quote: boolean; photos: boolean; details: boolean; appointment: boolean;
  callback: boolean; job: boolean; any: boolean;
}

export function briefFlags(briefText: string | null | undefined): BriefFlags {
  const t = briefText && briefText.trim() ? foldGreek(briefText) : '';
  const f = {
    quote: !!t && RE_QUOTE.test(t),
    photos: !!t && RE_PHOTOS.test(t),
    details: !!t && RE_DETAILS.test(t),
    appointment: !!t && RE_APPOINTMENT.test(t),
    callback: !!t && RE_CALLBACK.test(t),
    job: !!t && RE_JOB.test(t),
  };
  return { ...f, any: f.quote || f.photos || f.details || f.appointment || f.callback || f.job };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isTerminalFolder(status: string | null | undefined): boolean {
  return status === 'done' || status === 'archived';
}

// ---------------------------------------------------------------------------
// rankNextAction — the priority rules. Returns the single highest-priority match.
// Folder scope and customer (no-folder) scope have separate rule sets; in both,
// the FIRST rule that matches wins and its index is the priority.
// ---------------------------------------------------------------------------

export function rankNextAction(signals: NextActionSignals): RankedNextAction {
  const b = briefFlags(signals.briefText);
  const inactive = signals.lastActivityAtMs != null
    && signals.nowMs - signals.lastActivityAtMs > SEVEN_DAYS_MS;
  const terminal = isTerminalFolder(signals.folderStatus);

  const none: RankedNextAction = { actionType: 'no_action', priority: 999, confidence: 0, sourceEventType: null };

  // ---- Customer scope (no folder exists yet) -------------------------------
  // You must open a folder to organise/act, so the only forward move is to
  // create one (when a call discussed a job, or a customer message is waiting).
  if (signals.scope === 'customer') {
    if (b.job || b.quote || b.appointment || b.photos) {
      return { actionType: 'create_work_folder', priority: 10, confidence: 0.85, sourceEventType: 'call_brief' };
    }
    if (signals.inboundUnanswered) {
      return { actionType: 'create_work_folder', priority: 15, confidence: 0.6, sourceEventType: 'inbound_message' };
    }
    if (b.callback) {
      return { actionType: 'create_work_folder', priority: 20, confidence: 0.55, sourceEventType: 'call_brief' };
    }
    return none;
  }

  // ---- Folder scope --------------------------------------------------------
  // 1) Folder exists but the customer never got the link → share it.
  if (!signals.linkSent) {
    return { actionType: 'share_folder_link', priority: 20, confidence: 0.8, sourceEventType: 'folder_created' };
  }
  // 2) Brief says photos are needed and we don't have them / haven't asked.
  if (b.photos && !signals.uploadCompleted && !signals.photosRequestPending) {
    return { actionType: 'request_photos', priority: 30, confidence: 0.8, sourceEventType: 'call_brief' };
  }
  // 3) Brief says customer details/documents are needed and we don't have them.
  if (b.details && !signals.intakeSubmitted && !signals.detailsRequestPending) {
    return { actionType: 'request_customer_details', priority: 40, confidence: 0.75, sourceEventType: 'call_brief' };
  }
  // 4) Quote was discussed, OR the customer already supplied photos/details, and
  //    there is no offer yet → make the offer.
  if (!signals.hasOffer && (b.quote || signals.uploadCompleted || signals.intakeSubmitted)) {
    const fromInputs = signals.uploadCompleted || signals.intakeSubmitted;
    return {
      actionType: 'create_offer',
      priority: 50,
      confidence: fromInputs ? 0.85 : 0.8,
      sourceEventType: fromInputs ? (signals.uploadCompleted ? 'upload_completed' : 'intake_submitted') : 'call_brief',
    };
  }
  // 5) Offer sent, no answer after 48h → follow up.
  if (signals.offerSentAwaitingOver48h) {
    return { actionType: 'send_follow_up', priority: 70, confidence: 0.8, sourceEventType: 'offer_created' };
  }
  // 6) Customer accepted the offer, or the brief mentions a date/visit → book it.
  if (!signals.appointmentScheduled && (signals.offerAccepted || b.appointment)) {
    return {
      actionType: 'schedule_appointment',
      priority: 80,
      confidence: signals.offerAccepted ? 0.9 : 0.7,
      sourceEventType: signals.offerAccepted ? 'offer_response' : 'call_brief',
    };
  }
  // 7) A customer message is waiting for a reply.
  if (signals.inboundUnanswered) {
    return { actionType: 'reply_to_customer', priority: 90, confidence: 0.8, sourceEventType: 'inbound_message' };
  }
  // 8) The folder has gone quiet for a week → gentle follow-up.
  if (inactive && !terminal) {
    return { actionType: 'send_follow_up', priority: 100, confidence: 0.55, sourceEventType: 'folder_question' };
  }
  // 9) The work looks finished → close the folder.
  if (signals.workLooksComplete && !terminal) {
    return { actionType: 'mark_work_done', priority: 110, confidence: 0.7, sourceEventType: 'appointment_response' };
  }
  return none;
}

// ---------------------------------------------------------------------------
// describeNextAction — fixed Greek title + explanation. NEVER includes briefText
// (so no transcript/brief content can ever leak through the recommendation copy).
// ---------------------------------------------------------------------------

export interface NextActionCopy { title: string; explanation: string }

export function describeNextAction(action: RankedNextAction, signals: NextActionSignals): NextActionCopy {
  const title = NEXT_ACTION_LABELS[action.actionType];
  switch (action.actionType) {
    case 'create_work_folder':
      return { title, explanation: 'Στην κλήση συζητήθηκε νέα εργασία. Άνοιξε φάκελο για να την οργανώσεις.' };
    case 'share_folder_link':
      return { title, explanation: 'Έφτιαξες φάκελο αλλά δεν έχει σταλεί ακόμη ο σύνδεσμος στον πελάτη.' };
    case 'request_photos':
      return { title, explanation: 'Χρειάζεσαι φωτογραφίες για να προχωρήσεις με την προσφορά.' };
    case 'request_customer_details':
      return { title, explanation: 'Χρειάζεσαι τα στοιχεία του πελάτη (διεύθυνση, ΑΦΜ κ.λπ.).' };
    case 'create_offer': {
      const fromInputs = signals.uploadCompleted || signals.intakeSubmitted;
      return {
        title,
        explanation: fromInputs
          ? 'Ο πελάτης έστειλε στοιχεία — ετοίμασε προσφορά.'
          : 'Ο πελάτης ζήτησε τιμή. Ετοίμασε μια προσφορά.',
      };
    }
    case 'schedule_appointment':
      return {
        title,
        explanation: signals.offerAccepted
          ? 'Ο πελάτης αποδέχτηκε την προσφορά. Κλείσε ραντεβού.'
          : 'Στην κλήση συζητήθηκε ημερομηνία/επίσκεψη. Κλείσε ραντεβού.',
      };
    case 'send_follow_up':
      return {
        title,
        explanation: signals.offerSentAwaitingOver48h
          ? 'Η προσφορά στάλθηκε εδώ και 2+ μέρες χωρίς απάντηση. Κάνε ένα follow-up.'
          : 'Ο φάκελος είναι ανενεργός εδώ και μία εβδομάδα. Κάνε ένα follow-up.',
      };
    case 'reply_to_customer':
      return { title, explanation: 'Ο πελάτης έστειλε μήνυμα που δεν έχει απαντηθεί.' };
    case 'mark_work_done':
      return { title, explanation: 'Η εργασία φαίνεται ολοκληρωμένη. Κλείσε τον φάκελο.' };
    default:
      return { title: '', explanation: '' };
  }
}

// ---------------------------------------------------------------------------
// Lifecycle reconciliation — pure decision of what to show + persist, given the
// fresh candidate and the scope's existing rows (already business+scope-filtered).
// ---------------------------------------------------------------------------

export interface NextActionRecord {
  id: string;
  action_type: string;
  status: string;
  priority: number;
  due_at: string | null;   // ISO
  updated_at: string;      // ISO
}

export type ReconcileDecision =
  | { kind: 'none' }                                   // show nothing (snoozed/dismissed/no_action)
  | { kind: 'existing'; id: string }                  // keep showing the active row
  | { kind: 'retire'; id: string }                    // the active row's trigger resolved → close it, show nothing
  | { kind: 'insert'; supersedeId: string | null };   // (optionally supersede) then insert the candidate

// How long a dismissed action of the SAME type stays suppressed before it may
// re-surface as a gentle nudge.
export const DISMISS_SUPPRESS_MS = 24 * 60 * 60 * 1000;
export const ACCEPTED_SUPPRESS_MS = 24 * 60 * 60 * 1000;

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : null;
}

export function reconcileNextAction(
  candidate: RankedNextAction,
  existing: NextActionRecord[],
  nowMs: number,
): ReconcileDecision {
  const isNoAction = candidate.actionType === 'no_action';

  // The active row (pending|snoozed) — at most one per scope (DB unique index).
  const active = existing.find((r) => r.status === 'pending' || r.status === 'snoozed') ?? null;

  if (active) {
    if (active.status === 'snoozed') {
      const due = ms(active.due_at);
      const stillSnoozed = due != null && due > nowMs;
      if (stillSnoozed) {
        // A CLEARLY higher-priority action (lower number) breaks through the snooze;
        // a same/lower-priority candidate (or no_action) respects it until due_at.
        if (!isNoAction && candidate.priority < active.priority) {
          return { kind: 'insert', supersedeId: active.id };
        }
        return { kind: 'none' };
      }
      // Snooze expired → re-evaluate. If nothing is pending now, close it.
      if (isNoAction) return { kind: 'retire', id: active.id };
      return { kind: 'insert', supersedeId: active.id };
    }
    // active is pending
    if (isNoAction) return { kind: 'retire', id: active.id }; // trigger resolved → close it
    if (active.action_type === candidate.actionType) return { kind: 'existing', id: active.id };
    // Supersede ONLY if the candidate is clearly higher priority (lower number).
    if (candidate.priority < active.priority) return { kind: 'insert', supersedeId: active.id };
    return { kind: 'existing', id: active.id };
  }

  // No active row. Nothing to show / persist for no_action.
  if (isNoAction) return { kind: 'none' };

  // Suppress an action that was just dismissed/accepted/completed for the SAME
  // type, so "Όχι τώρα"/"Εκτέλεση" don't make it pop straight back.
  const sameType = existing
    .filter((r) => r.action_type === candidate.actionType
      && (r.status === 'dismissed' || r.status === 'accepted' || r.status === 'completed'))
    .sort((a, b) => (ms(b.updated_at) ?? 0) - (ms(a.updated_at) ?? 0))[0];
  if (sameType) {
    const at = ms(sameType.updated_at) ?? 0;
    const window = sameType.status === 'dismissed' ? DISMISS_SUPPRESS_MS : ACCEPTED_SUPPRESS_MS;
    if (nowMs - at < window) return { kind: 'none' };
  }

  return { kind: 'insert', supersedeId: null };
}

// ---------------------------------------------------------------------------
// Client shape — the ONLY fields ever sent to the (business) client. Deliberately
// omits business_id, customer_id, work_folder_id, source_event_id and any brief
// text, so nothing internal leaks even to the authenticated technician UI.
// ---------------------------------------------------------------------------

export interface ClientNextAction {
  id: string | null;          // null when computed-only (table not applied yet)
  actionType: NextActionType;
  title: string;
  explanation: string;
  confidence: number | null;
  dueAt: string | null;
  persistent: boolean;        // false → dismiss/snooze are local-only until migration 054 lands
}

export function toClientAction(
  row: { id: string | null; action_type: string; title: string; explanation: string | null; confidence: number | null; due_at: string | null },
  persistent: boolean,
): ClientNextAction {
  return {
    id: row.id,
    actionType: isNextActionType(row.action_type) ? row.action_type : 'no_action',
    title: row.title,
    explanation: row.explanation ?? '',
    confidence: row.confidence,
    dueAt: row.due_at,
    persistent,
  };
}
