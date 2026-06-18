import { describe, it, expect } from 'vitest';
import {
  rankNextAction, describeNextAction, reconcileNextAction, toClientAction,
  briefFlags, isNextActionType,
  type NextActionSignals, type NextActionRecord,
} from '../next-action';

const NOW = 1_700_000_000_000;

function folder(partial: Partial<NextActionSignals>): NextActionSignals {
  // A "settled" folder: link sent, no outstanding signals → defaults to no_action.
  return { scope: 'folder', nowMs: NOW, folderStatus: 'in_progress', linkSent: true, ...partial };
}
function customer(partial: Partial<NextActionSignals>): NextActionSignals {
  return { scope: 'customer', nowMs: NOW, ...partial };
}

describe('rankNextAction — folder scope', () => {
  it('share_folder_link when the folder link was never sent', () => {
    expect(rankNextAction(folder({ linkSent: false })).actionType).toBe('share_folder_link');
  });

  it('request_photos when the brief mentions photos (and none received/requested)', () => {
    const r = rankNextAction(folder({ briefText: 'Ο πελάτης θα στείλει φωτογραφίες για τη βλάβη' }));
    expect(r.actionType).toBe('request_photos');
  });

  it('request_customer_details when the brief mentions details/ΑΦΜ', () => {
    const r = rankNextAction(folder({ briefText: 'Χρειαζόμαστε τη διεύθυνση και το ΑΦΜ του πελάτη' }));
    expect(r.actionType).toBe('request_customer_details');
  });

  it('create_offer when the brief mentions a quote and no offer exists', () => {
    const r = rankNextAction(folder({ briefText: 'Ζήτησε προσφορά / τιμή για την εργασία' }));
    expect(r.actionType).toBe('create_offer');
  });

  it('create_offer when the customer already uploaded photos', () => {
    const r = rankNextAction(folder({ uploadCompleted: true }));
    expect(r.actionType).toBe('create_offer');
  });

  it('send_follow_up when an offer was sent ≥48h ago without an answer', () => {
    const r = rankNextAction(folder({ hasOffer: true, offerSentAwaitingOver48h: true }));
    expect(r.actionType).toBe('send_follow_up');
  });

  it('schedule_appointment when the offer was accepted', () => {
    const r = rankNextAction(folder({ hasOffer: true, offerAccepted: true }));
    expect(r.actionType).toBe('schedule_appointment');
  });

  it('schedule_appointment when the brief mentions a date/visit', () => {
    const r = rankNextAction(folder({ hasOffer: true, briefText: 'Κλείσαμε ραντεβού για επίσκεψη την Τρίτη' }));
    expect(r.actionType).toBe('schedule_appointment');
  });

  it('reply_to_customer when the last message is an unanswered inbound', () => {
    const r = rankNextAction(folder({ hasOffer: true, inboundUnanswered: true }));
    expect(r.actionType).toBe('reply_to_customer');
  });

  it('send_follow_up when the folder has been inactive for >7 days', () => {
    const r = rankNextAction(folder({ hasOffer: true, lastActivityAtMs: NOW - 8 * 24 * 60 * 60 * 1000 }));
    expect(r.actionType).toBe('send_follow_up');
  });

  it('no_action when nothing useful is pending', () => {
    expect(rankNextAction(folder({})).actionType).toBe('no_action');
  });

  it('priority ordering: an unsent link outranks a quote in the same brief', () => {
    const r = rankNextAction(folder({ linkSent: false, briefText: 'Ζήτησε προσφορά και θα στείλει φωτογραφίες' }));
    expect(r.actionType).toBe('share_folder_link');
  });

  it('does not re-suggest create_offer once an offer exists', () => {
    const r = rankNextAction(folder({ hasOffer: true, briefText: 'τιμή / προσφορά' }));
    expect(r.actionType).not.toBe('create_offer');
  });
});

describe('rankNextAction — customer (no-folder) scope', () => {
  it('create_work_folder when a call discussed a job but there is no folder', () => {
    const r = rankNextAction(customer({ briefText: 'Συζητήσαμε τοποθέτηση κλιματιστικού, θέλει προσφορά' }));
    expect(r.actionType).toBe('create_work_folder');
  });

  it('create_work_folder when an inbound message is waiting', () => {
    const r = rankNextAction(customer({ inboundUnanswered: true }));
    expect(r.actionType).toBe('create_work_folder');
  });

  it('no_action when there is no signal at all', () => {
    expect(rankNextAction(customer({})).actionType).toBe('no_action');
  });
});

describe('reconcileNextAction — lifecycle / one-active-per-scope', () => {
  const cand = { actionType: 'create_offer' as const, priority: 50, confidence: 0.8, sourceEventType: 'call_brief' };

  it('inserts when there is no existing row', () => {
    expect(reconcileNextAction(cand, [], NOW)).toEqual({ kind: 'insert', supersedeId: null });
  });

  it('keeps the existing active row when the candidate is the same type', () => {
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'pending', priority: 50, due_at: null, updated_at: new Date(NOW).toISOString() }];
    expect(reconcileNextAction(cand, rows, NOW)).toEqual({ kind: 'existing', id: 'a' });
  });

  it('keeps a lower-priority active row (no downgrade — only one active)', () => {
    const higher = { actionType: 'send_follow_up' as const, priority: 70, confidence: 0.8, sourceEventType: null };
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'pending', priority: 50, due_at: null, updated_at: new Date(NOW).toISOString() }];
    expect(reconcileNextAction(higher, rows, NOW)).toEqual({ kind: 'existing', id: 'a' });
  });

  it('supersedes the active row when the candidate is clearly higher priority', () => {
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'send_follow_up', status: 'pending', priority: 70, due_at: null, updated_at: new Date(NOW).toISOString() }];
    expect(reconcileNextAction(cand, rows, NOW)).toEqual({ kind: 'insert', supersedeId: 'a' });
  });

  it('hides a snoozed action until its due time', () => {
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'snoozed', priority: 50, due_at: new Date(NOW + 3600_000).toISOString(), updated_at: new Date(NOW).toISOString() }];
    expect(reconcileNextAction(cand, rows, NOW)).toEqual({ kind: 'none' });
  });

  it('re-evaluates once the snooze has expired', () => {
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'snoozed', priority: 50, due_at: new Date(NOW - 1000).toISOString(), updated_at: new Date(NOW - 7200_000).toISOString() }];
    expect(reconcileNextAction(cand, rows, NOW)).toEqual({ kind: 'insert', supersedeId: 'a' });
  });

  it('does NOT reappear immediately after being dismissed (same type, within window)', () => {
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'dismissed', priority: 50, due_at: null, updated_at: new Date(NOW - 60_000).toISOString() }];
    expect(reconcileNextAction(cand, rows, NOW)).toEqual({ kind: 'none' });
  });

  it('may re-surface long after a dismissal (window elapsed)', () => {
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'dismissed', priority: 50, due_at: null, updated_at: new Date(NOW - 48 * 60 * 60 * 1000).toISOString() }];
    expect(reconcileNextAction(cand, rows, NOW)).toEqual({ kind: 'insert', supersedeId: null });
  });

  it('a different fresh action is shown even if another type was just dismissed', () => {
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'request_photos', status: 'dismissed', priority: 30, due_at: null, updated_at: new Date(NOW - 60_000).toISOString() }];
    expect(reconcileNextAction(cand, rows, NOW)).toEqual({ kind: 'insert', supersedeId: null });
  });

  it('shows nothing for a no_action candidate with no active row', () => {
    const none = { actionType: 'no_action' as const, priority: 999, confidence: 0, sourceEventType: null };
    expect(reconcileNextAction(none, [], NOW)).toEqual({ kind: 'none' });
  });

  it('retires the active pending action once its trigger has resolved (candidate no_action)', () => {
    const none = { actionType: 'no_action' as const, priority: 999, confidence: 0, sourceEventType: null };
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'pending', priority: 50, due_at: null, updated_at: new Date(NOW).toISOString() }];
    expect(reconcileNextAction(none, rows, NOW)).toEqual({ kind: 'retire', id: 'a' });
  });

  it('keeps a not-yet-due snooze hidden even when the candidate is no_action', () => {
    const none = { actionType: 'no_action' as const, priority: 999, confidence: 0, sourceEventType: null };
    const rows: NextActionRecord[] = [{ id: 'a', action_type: 'create_offer', status: 'snoozed', priority: 50, due_at: new Date(NOW + 3600_000).toISOString(), updated_at: new Date(NOW).toISOString() }];
    expect(reconcileNextAction(none, rows, NOW)).toEqual({ kind: 'none' });
  });

  // ── Snooze + higher-priority breakthrough (must-fix #1) ──
  const snoozedLow: NextActionRecord = {
    id: 'snz', action_type: 'send_follow_up', status: 'snoozed', priority: 100,
    due_at: new Date(NOW + 3600_000).toISOString(), updated_at: new Date(NOW).toISOString(),
  };

  it('keeps a not-yet-due snoozed low-priority action hidden for a same/lower-priority candidate', () => {
    const samePriority = { actionType: 'send_follow_up' as const, priority: 100, confidence: 0.5, sourceEventType: null };
    const lowerPriority = { actionType: 'mark_work_done' as const, priority: 110, confidence: 0.7, sourceEventType: null };
    expect(reconcileNextAction(samePriority, [snoozedLow], NOW)).toEqual({ kind: 'none' });
    expect(reconcileNextAction(lowerPriority, [snoozedLow], NOW)).toEqual({ kind: 'none' });
  });

  it('supersedes a not-yet-due snoozed action when a clearly higher-priority candidate appears', () => {
    const higher = { actionType: 'reply_to_customer' as const, priority: 90, confidence: 0.8, sourceEventType: 'inbound_message' };
    expect(reconcileNextAction(higher, [snoozedLow], NOW)).toEqual({ kind: 'insert', supersedeId: 'snz' });
  });

  it('returns the higher-priority action to the client when it breaks through a snooze', () => {
    const higher = { actionType: 'reply_to_customer' as const, priority: 90, confidence: 0.8, sourceEventType: 'inbound_message' };
    const decision = reconcileNextAction(higher, [snoozedLow], NOW);
    expect(decision.kind).toBe('insert');
    // The row the store would insert + return carries the higher-priority action, not the snoozed one.
    const client = toClientAction(
      { id: 'na2', action_type: higher.actionType, title: 'Απάντησε στον πελάτη', explanation: '', confidence: higher.confidence, due_at: null },
      true,
    );
    expect(client.actionType).toBe('reply_to_customer');
  });
});

describe('appointment keyword precision (must-fix #2)', () => {
  it('common words/greetings do NOT count as an appointment signal', () => {
    for (const w of ['καλημέρα', 'σήμερα', 'ωραία', 'ωραίο', 'μια ώρα', 'καλησπέρα']) {
      expect(briefFlags(w).appointment, w).toBe(false);
    }
  });

  it('real appointment signals DO count', () => {
    for (const w of ['ραντεβού', 'επίσκεψη', 'αυτοψία', 'ημερομηνία', 'να περάσω', 'θα έρθω αύριο']) {
      expect(briefFlags(w).appointment, w).toBe(true);
    }
  });

  it('«καλημέρα, θέλω προσφορά» → create_offer, NOT schedule_appointment', () => {
    const r = rankNextAction(folder({ briefText: 'Καλημέρα, θέλω προσφορά για την εργασία' }));
    expect(r.actionType).toBe('create_offer');
  });

  it('«σήμερα θέλω μια τιμή» → create_offer, NOT schedule_appointment', () => {
    const r = rankNextAction(folder({ briefText: 'Σήμερα θέλω μια τιμή' }));
    expect(r.actionType).not.toBe('schedule_appointment');
    expect(r.actionType).toBe('create_offer');
  });

  it('«ωραία, στείλε προσφορά» → create_offer, NOT schedule_appointment', () => {
    const r = rankNextAction(folder({ briefText: 'Ωραία, στείλε προσφορά' }));
    expect(r.actionType).toBe('create_offer');
  });

  it('«να κλείσουμε ραντεβού» → schedule_appointment', () => {
    const r = rankNextAction(folder({ briefText: 'Να κλείσουμε ραντεβού' }));
    expect(r.actionType).toBe('schedule_appointment');
  });

  it('«να περάσω για αυτοψία» → schedule_appointment', () => {
    const r = rankNextAction(folder({ briefText: 'Να περάσω για αυτοψία' }));
    expect(r.actionType).toBe('schedule_appointment');
  });
});

describe('no internal exposure', () => {
  it('the client shape exposes only safe fields (no business/customer/folder/source ids, no brief)', () => {
    const client = toClientAction(
      { id: 'x', action_type: 'create_offer', title: 'Δημιουργία προσφοράς', explanation: 'Ο πελάτης ζήτησε τιμή.', confidence: 0.8, due_at: null },
      true,
    );
    expect(Object.keys(client).sort()).toEqual(
      ['actionType', 'confidence', 'dueAt', 'explanation', 'id', 'persistent', 'title'].sort(),
    );
  });

  it('describeNextAction never echoes raw brief/transcript text', () => {
    const secret = 'SECRET_TRANSCRIPT_abc123 ο πελάτης είπε προσφορά';
    const signals = folder({ briefText: secret });
    const ranked = rankNextAction(signals);
    const copy = describeNextAction(ranked, signals);
    expect(copy.title.includes('SECRET_TRANSCRIPT')).toBe(false);
    expect(copy.explanation.includes('SECRET_TRANSCRIPT')).toBe(false);
  });
});

describe('helpers', () => {
  it('isNextActionType accepts known + rejects unknown', () => {
    expect(isNextActionType('create_offer')).toBe(true);
    expect(isNextActionType('nope')).toBe(false);
    expect(isNextActionType(7)).toBe(false);
  });

  it('briefFlags folds Greek accents/case', () => {
    expect(briefFlags('ΠΡΟΣΦΟΡΆ').quote).toBe(true);
    expect(briefFlags('φωτογραφίες').photos).toBe(true);
    expect(briefFlags('').any).toBe(false);
    expect(briefFlags(null).any).toBe(false);
  });
});
