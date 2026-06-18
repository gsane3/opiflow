// CAM Attention / Reminder Engine (v1) — the single primary attention state per
// work folder. Opiflow is a Customer-Action machine: this answers "who are we
// waiting on / what needs to happen now", NOT a progress bar (no Lead→Offer→Done
// stages). DETERMINISTIC rules only (no LLM). Computed-only — nothing is persisted
// here, no migration, no cron.
//
// It complements (does not duplicate) the Next Best Action card: Attention =
// current STATE ("Περιμένει ο πελάτης"); NBA = the recommended ACTION ("Ζήτα
// φωτογραφίες"). Labels here are STATE-framed; the only CTA is the urgent reply
// shortcut (every other action is carried by the NBA card below). The engine takes
// NO brief/transcript text — labels/explanations are fixed Greek templates, so no
// call content can ever leak through attention.
//
// Pure + dependency-free → fully unit-testable; the DB signal-loading lives in
// folder-attention-store.ts.

export type AttentionWaitingOn = 'business' | 'customer' | 'date' | 'none';
export type AttentionSeverity = 'info' | 'warning' | 'urgent';
export type AttentionSource =
  | 'folder' | 'call' | 'message' | 'offer' | 'appointment'
  | 'upload_request' | 'intake_request' | 'next_action';

export interface AttentionCta { actionType: string; label: string }

export interface FolderAttention {
  waitingOn: AttentionWaitingOn;
  severity: AttentionSeverity;
  reason: string;              // machine code (internal — not exposed to the client)
  label: string;               // Greek STATE label
  explanation?: string;
  nextActionType?: string | null; // internal hint (not exposed)
  dueAt?: string | null;
  source: AttentionSource;
  cta?: AttentionCta | null;   // optional UI button (only the urgent reply shortcut in v1)
}

// Deterministic inputs — all optional so callers/tests set only what they know.
// NOTE: there is deliberately NO briefText/transcript field here.
export interface AttentionSignals {
  nowMs: number;
  folderStatus?: string | null;          // open | in_progress | done | archived
  linkSent?: boolean;                    // folder portal link delivered (sent|opened)
  inboundUnanswered?: boolean;           // last message is an inbound customer message
  hasOffer?: boolean;                    // an offer exists
  uploadCompleted?: boolean;             // customer uploaded photos/files
  intakeSubmitted?: boolean;             // customer submitted their details
  offerAwaitingOver48h?: boolean;        // offer sent ≥48h ago, still no answer
  uploadRequestPendingOver48h?: boolean; // photo request sent ≥48h ago, not completed
  intakeRequestPendingOver48h?: boolean; // details request sent ≥48h ago, not submitted
  appointmentDue?: 'today' | 'tomorrow' | null;
  appointmentDueAt?: string | null;
  activeNextActionType?: string | null;  // an active (visible) next_actions row, if any
  activeNextActionDueAt?: string | null;
  lastActivityAtMs?: number | null;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isTerminalFolder(status?: string | null): boolean {
  return status === 'done' || status === 'archived';
}

/**
 * Compute the single primary attention state for an active folder. Returns null
 * for closed (done/archived) folders so the card hides — closed work never raises
 * attention. First matching rule wins (priority order = Part B).
 */
export function computeFolderAttention(s: AttentionSignals): FolderAttention | null {
  if (isTerminalFolder(s.folderStatus)) return null;

  // 1) Unanswered inbound customer message — most urgent; business must reply.
  if (s.inboundUnanswered) {
    return {
      waitingOn: 'business', severity: 'urgent', reason: 'unanswered_message',
      label: 'Ο πελάτης έστειλε μήνυμα', explanation: 'Χρειάζεται απάντηση.',
      nextActionType: 'reply_to_customer', source: 'message',
      cta: { actionType: 'reply_to_customer', label: 'Απάντησε' },
    };
  }

  // 2) Customer supplied photos/details but no offer yet → you owe an offer.
  if (!s.hasOffer && (s.uploadCompleted || s.intakeSubmitted)) {
    return {
      waitingOn: 'business', severity: 'warning', reason: 'inputs_ready_no_offer',
      label: 'Ο πελάτης έστειλε στοιχεία', explanation: 'Μπορείς να ετοιμάσεις προσφορά.',
      nextActionType: 'create_offer',
      source: s.uploadCompleted ? 'upload_request' : 'intake_request', cta: null,
    };
  }

  // 3) Appointment today/tomorrow — date reminder (no action owed).
  if (s.appointmentDue) {
    const today = s.appointmentDue === 'today';
    return {
      waitingOn: 'date', severity: today ? 'warning' : 'info', reason: 'appointment_soon',
      label: today ? 'Σήμερα έχεις ραντεβού' : 'Αύριο έχεις ραντεβού',
      explanation: today ? 'Ετοιμάσου για το σημερινό ραντεβού.' : 'Ετοιμάσου για το αυριανό ραντεβού.',
      nextActionType: null, dueAt: s.appointmentDueAt ?? null, source: 'appointment', cta: null,
    };
  }

  // 4) Offer sent, no answer after 48h → customer is sitting on it.
  if (s.offerAwaitingOver48h) {
    return {
      waitingOn: 'customer', severity: 'warning', reason: 'offer_no_response_48h',
      label: 'Η προσφορά δεν έχει απάντηση', explanation: 'Πέρασαν 2+ μέρες χωρίς απάντηση.',
      nextActionType: 'send_follow_up', source: 'offer', cta: null,
    };
  }

  // 5) Photo upload request pending for 48h.
  if (s.uploadRequestPendingOver48h) {
    return {
      waitingOn: 'customer', severity: 'warning', reason: 'upload_pending_48h',
      label: 'Ο πελάτης δεν ανέβασε φωτογραφίες ακόμα', explanation: 'Το αίτημα στάλθηκε πριν 2+ μέρες.',
      nextActionType: 'send_follow_up', source: 'upload_request', cta: null,
    };
  }

  // 6) Details/intake request pending for 48h.
  if (s.intakeRequestPendingOver48h) {
    return {
      waitingOn: 'customer', severity: 'warning', reason: 'intake_pending_48h',
      label: 'Ο πελάτης δεν έστειλε στοιχεία ακόμα', explanation: 'Το αίτημα στάλθηκε πριν 2+ μέρες.',
      nextActionType: 'send_follow_up', source: 'intake_request', cta: null,
    };
  }

  // 7) Folder link not delivered/opened yet.
  if (!s.linkSent) {
    return {
      waitingOn: 'business', severity: 'info', reason: 'link_not_sent',
      label: 'Ο πελάτης δεν έχει ακόμα το link', explanation: 'Στείλε τον σύνδεσμο του φακέλου στον πελάτη.',
      nextActionType: 'share_folder_link', source: 'folder', cta: null,
    };
  }

  // 8) An active Next Best Action is pending/visible → reflect that something
  //    needs doing WITHOUT duplicating the NBA card's button (no CTA here).
  if (s.activeNextActionType && s.activeNextActionType !== 'no_action') {
    return {
      waitingOn: 'business', severity: 'info', reason: 'next_action_pending',
      label: 'Εκκρεμεί ενέργεια', explanation: 'Δες την προτεινόμενη ενέργεια πιο κάτω.',
      nextActionType: s.activeNextActionType, dueAt: s.activeNextActionDueAt ?? null,
      source: 'next_action', cta: null,
    };
  }

  // 9) Folder inactive for 7 days → stale work.
  if (s.lastActivityAtMs != null && s.nowMs - s.lastActivityAtMs > SEVEN_DAYS_MS) {
    return {
      waitingOn: 'business', severity: 'warning', reason: 'stale_7d',
      label: 'Η εργασία έχει μείνει στάσιμη', explanation: 'Καμία ενημέρωση εδώ και μία εβδομάδα.',
      nextActionType: 'send_follow_up', source: 'folder', cta: null,
    };
  }

  // 10) Nothing needed right now.
  return {
    waitingOn: 'none', severity: 'info', reason: 'all_clear',
    label: 'Δεν χρειάζεται κάτι τώρα', nextActionType: null, source: 'folder', cta: null,
  };
}

// Client shape — the ONLY fields sent to the (business) client. Omits the internal
// `reason` and `nextActionType`, and never carries IDs or any brief/transcript text.
export interface ClientFolderAttention {
  waitingOn: AttentionWaitingOn;
  severity: AttentionSeverity;
  label: string;
  explanation: string | null;
  dueAt: string | null;
  source: AttentionSource;
  cta: AttentionCta | null;
}

export function toClientAttention(a: FolderAttention | null): ClientFolderAttention | null {
  if (!a) return null;
  return {
    waitingOn: a.waitingOn,
    severity: a.severity,
    label: a.label,
    explanation: a.explanation ?? null,
    dueAt: a.dueAt ?? null,
    source: a.source,
    cta: a.cta ?? null,
  };
}
