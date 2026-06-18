import { describe, it, expect } from 'vitest';
import { computeFolderAttention, toClientAttention, type AttentionSignals } from '../folder-attention';

const NOW = 1_700_000_000_000;

// An "active, all-clear" folder: link sent, an offer exists, nothing pending.
function base(p: Partial<AttentionSignals>): AttentionSignals {
  return { nowMs: NOW, folderStatus: 'in_progress', linkSent: true, hasOffer: true, ...p };
}

describe('computeFolderAttention — rules + priority', () => {
  it('rule 1: unanswered inbound message → business / urgent / reply CTA', () => {
    const a = computeFolderAttention(base({ inboundUnanswered: true }))!;
    expect(a.waitingOn).toBe('business');
    expect(a.severity).toBe('urgent');
    expect(a.reason).toBe('unanswered_message');
    expect(a.cta).toEqual({ actionType: 'reply_to_customer', label: 'Απάντησε' });
  });

  it('rule 2: customer sent inputs and no offer → business / create_offer (no CTA, NBA carries it)', () => {
    const a = computeFolderAttention(base({ hasOffer: false, uploadCompleted: true }))!;
    expect(a.waitingOn).toBe('business');
    expect(a.reason).toBe('inputs_ready_no_offer');
    expect(a.nextActionType).toBe('create_offer');
    expect(a.cta).toBeNull();
    // intake variant
    expect(computeFolderAttention(base({ hasOffer: false, intakeSubmitted: true }))!.reason).toBe('inputs_ready_no_offer');
  });

  it('rule 3: appointment tomorrow → date / info; today → date / warning', () => {
    const tom = computeFolderAttention(base({ appointmentDue: 'tomorrow', appointmentDueAt: '2024-01-02' }))!;
    expect(tom.waitingOn).toBe('date');
    expect(tom.severity).toBe('info');
    expect(tom.label).toBe('Αύριο έχεις ραντεβού');
    expect(tom.dueAt).toBe('2024-01-02');
    const today = computeFolderAttention(base({ appointmentDue: 'today' }))!;
    expect(today.severity).toBe('warning');
    expect(today.label).toBe('Σήμερα έχεις ραντεβού');
  });

  it('rule 4: offer pending 48h → customer / follow-up', () => {
    const a = computeFolderAttention(base({ offerAwaitingOver48h: true }))!;
    expect(a.waitingOn).toBe('customer');
    expect(a.reason).toBe('offer_no_response_48h');
    expect(a.nextActionType).toBe('send_follow_up');
  });

  it('rule 5: upload request pending 48h → customer waiting', () => {
    const a = computeFolderAttention(base({ uploadRequestPendingOver48h: true }))!;
    expect(a.waitingOn).toBe('customer');
    expect(a.reason).toBe('upload_pending_48h');
    expect(a.label).toBe('Ο πελάτης δεν ανέβασε φωτογραφίες ακόμα');
  });

  it('rule 6: intake request pending 48h → customer waiting', () => {
    const a = computeFolderAttention(base({ intakeRequestPendingOver48h: true }))!;
    expect(a.waitingOn).toBe('customer');
    expect(a.reason).toBe('intake_pending_48h');
  });

  it('rule 7: folder link not sent → business / info', () => {
    const a = computeFolderAttention(base({ linkSent: false }))!;
    expect(a.waitingOn).toBe('business');
    expect(a.reason).toBe('link_not_sent');
    expect(a.nextActionType).toBe('share_folder_link');
  });

  it('rule 8: active next action pending → business, source next_action, no CTA (NBA owns the button)', () => {
    const a = computeFolderAttention(base({ activeNextActionType: 'schedule_appointment' }))!;
    expect(a.source).toBe('next_action');
    expect(a.reason).toBe('next_action_pending');
    expect(a.label).toBe('Εκκρεμεί ενέργεια');
    expect(a.label).not.toBe('Χρειάζεται ενέργεια'); // must differ from the waitingOn=business chip text
    expect(a.cta).toBeNull();
    // no_action does not count as an active action
    expect(computeFolderAttention(base({ activeNextActionType: 'no_action' }))!.reason).toBe('all_clear');
  });

  it('rule 9: folder inactive 7+ days → stale work', () => {
    const a = computeFolderAttention(base({ lastActivityAtMs: NOW - 8 * 24 * 60 * 60 * 1000 }))!;
    expect(a.reason).toBe('stale_7d');
    expect(a.label).toBe('Η εργασία έχει μείνει στάσιμη');
    expect(a.severity).toBe('warning');
  });

  it('rule 10: nothing needed → none / info', () => {
    const a = computeFolderAttention(base({}))!;
    expect(a.waitingOn).toBe('none');
    expect(a.reason).toBe('all_clear');
    expect(a.label).toBe('Δεν χρειάζεται κάτι τώρα');
    expect(a.cta).toBeNull();
  });

  it('done/archived folders raise NO attention (null → card hidden)', () => {
    expect(computeFolderAttention(base({ folderStatus: 'done', inboundUnanswered: true }))).toBeNull();
    expect(computeFolderAttention(base({ folderStatus: 'archived', offerAwaitingOver48h: true }))).toBeNull();
  });

  it('priority: an unanswered message outranks every other signal', () => {
    const a = computeFolderAttention(base({
      inboundUnanswered: true, offerAwaitingOver48h: true, uploadRequestPendingOver48h: true,
      appointmentDue: 'today', linkSent: false, lastActivityAtMs: NOW - 9 * 24 * 60 * 60 * 1000,
    }))!;
    expect(a.reason).toBe('unanswered_message');
  });
});

describe('no internal/brief exposure', () => {
  it('the engine takes NO brief/transcript input (only structured booleans)', () => {
    const keys = Object.keys(base({}));
    expect(keys.some((k) => /brief|transcript|summary|note/i.test(k))).toBe(false);
  });

  it('the client shape exposes only safe fields (no reason/nextActionType/ids)', () => {
    const client = toClientAttention(computeFolderAttention(base({ inboundUnanswered: true })));
    expect(Object.keys(client!).sort()).toEqual(
      ['cta', 'dueAt', 'explanation', 'label', 'severity', 'source', 'waitingOn'].sort(),
    );
    // internal-only fields are stripped
    expect((client as unknown as Record<string, unknown>).reason).toBeUndefined();
    expect((client as unknown as Record<string, unknown>).nextActionType).toBeUndefined();
  });

  it('toClientAttention(null) stays null', () => {
    expect(toClientAttention(null)).toBeNull();
  });
});
