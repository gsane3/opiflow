import { describe, it, expect } from 'vitest';
import {
  checkTwilioTokenGate,
  isBrowserActivationAllowed,
  loadBrowserTokenBusiness,
  resolvePerUserCredential,
  getBusinessCount,
  readTelephony,
  validateTelephony,
  writeTelephony,
  readPresence,
  validatePresence,
  writePresence,
  isMissingColumn,
  readRecording,
  validateRecording,
  writeRecording,
} from '../phone.service';

// --- hermetic supabase fake -------------------------------------------------
// from(table) returns a thenable query builder that records ops and resolves
// from `resolve(table, ops)`; every chain method returns the same builder.
type Resolver = (table: string, ops: Array<[string, unknown[]]>) => { data?: unknown; error?: unknown; count?: unknown };

function fakeSupabase(resolve: Resolver) {
  function makeBuilder(table: string) {
    const ops: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      ops.push([name, args]);
      return builder;
    };
    for (const m of [
      'select', 'eq', 'neq', 'in', 'is', 'or', 'not', 'order', 'range', 'limit',
      'update', 'insert', 'delete', 'upsert',
    ]) {
      builder[m] = chain(m);
    }
    builder.single = () => Promise.resolve(resolve(table, ops));
    builder.maybeSingle = () => Promise.resolve(resolve(table, ops));
    builder.then = (cb: (r: { data?: unknown; error?: unknown; count?: unknown }) => unknown) =>
      Promise.resolve(cb(resolve(table, ops)));
    return builder;
  }
  return {
    from: (table: string) => makeBuilder(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as never;
}

// ---- twilio-token gate -----------------------------------------------------

describe('checkTwilioTokenGate', () => {
  it('rejects when no number is assigned (409 no_number_assigned)', async () => {
    const sb = fakeSupabase((table) =>
      table === 'businesses' ? { data: { business_phone_number: null }, error: null } : { data: null, error: null },
    );
    await expect(checkTwilioTokenGate(sb, 'biz1')).resolves.toEqual({
      ok: false,
      error: 'no_number_assigned',
      status: 409,
    });
  });

  it('rejects when subscription is not entitled (403 activation_required)', async () => {
    const sb = fakeSupabase((table) => {
      if (table === 'businesses') return { data: { business_phone_number: '+302100000000' }, error: null };
      if (table === 'business_subscriptions') return { data: { status: 'pending_payment' }, error: null };
      return { data: null, error: null };
    });
    await expect(checkTwilioTokenGate(sb, 'biz1')).resolves.toEqual({
      ok: false,
      error: 'activation_required',
      status: 403,
    });
  });

  it('passes for an assigned number + entitled subscription', async () => {
    const sb = fakeSupabase((table) => {
      if (table === 'businesses') return { data: { business_phone_number: '+302100000000' }, error: null };
      if (table === 'business_subscriptions') return { data: { status: 'active' }, error: null };
      return { data: null, error: null };
    });
    await expect(checkTwilioTokenGate(sb, 'biz1')).resolves.toEqual({ ok: true });
  });
});

// ---- browser-token helpers -------------------------------------------------

describe('browser-token helpers', () => {
  it('loadBrowserTokenBusiness returns the raw { data, error }', async () => {
    const sb = fakeSupabase(() => ({ data: { id: 'biz1', business_phone_number: '+3021' }, error: null }));
    await expect(loadBrowserTokenBusiness(sb, 'biz1')).resolves.toEqual({
      data: { id: 'biz1', business_phone_number: '+3021' },
      error: null,
    });
  });

  it('isBrowserActivationAllowed mirrors isEntitled', async () => {
    const ok = fakeSupabase(() => ({ data: { status: 'trialing' }, error: null }));
    const no = fakeSupabase(() => ({ data: { status: 'past_due' }, error: null }));
    await expect(isBrowserActivationAllowed(ok, 'biz1')).resolves.toBe(true);
    await expect(isBrowserActivationAllowed(no, 'biz1')).resolves.toBe(false);
  });

  it('getBusinessCount returns the exact count (0 when null)', async () => {
    const one = fakeSupabase(() => ({ count: 2 }));
    const none = fakeSupabase(() => ({ count: null }));
    await expect(getBusinessCount(one)).resolves.toBe(2);
    await expect(getBusinessCount(none)).resolves.toBe(0);
  });

  it('resolvePerUserCredential falls back to null when no endpoint row exists', async () => {
    const sb = fakeSupabase(() => ({ rows: [], error: null, data: [] }));
    await expect(resolvePerUserCredential(sb, 'biz1')).resolves.toBeNull();
  });

  it('resolvePerUserCredential falls back to null when the password is unminted', async () => {
    const sb = fakeSupabase(() => ({
      data: [{ id: 'e1', sip_username: 'biz_1', sip_password_enc: null, status: 'active' }],
    }));
    await expect(resolvePerUserCredential(sb, 'biz1')).resolves.toBeNull();
  });
});

// ---- telephony -------------------------------------------------------------

describe('telephony', () => {
  it('readTelephony maps the row fields', async () => {
    const sb = fakeSupabase(() => ({
      data: { telephony_mode: 'forward', forwarding_source_number: '+3021', business_phone_number: '+3022' },
      error: null,
    }));
    await expect(readTelephony(sb, 'biz1')).resolves.toEqual({
      mode: 'forward',
      forwardingSourceNumber: '+3021',
      businessPhoneNumber: '+3022',
    });
  });

  it('readTelephony defaults to nulls when no row', async () => {
    const sb = fakeSupabase(() => ({ data: null, error: null }));
    await expect(readTelephony(sb, 'biz1')).resolves.toEqual({
      mode: null,
      forwardingSourceNumber: null,
      businessPhoneNumber: null,
    });
  });

  it('validateTelephony rejects an unknown mode', () => {
    expect(validateTelephony({ mode: 'nope' })).toEqual({ ok: false, error: 'invalid_mode' });
  });

  it('validateTelephony keeps the source number only in forward mode', () => {
    expect(validateTelephony({ mode: 'forward', forwardingSourceNumber: '(210) 555' })).toEqual({
      ok: true,
      mode: 'forward',
      forwardingSourceNumber: '210555',
    });
    expect(validateTelephony({ mode: 'native', forwardingSourceNumber: '210555' })).toEqual({
      ok: true,
      mode: 'native',
      forwardingSourceNumber: null,
    });
  });

  it('writeTelephony surfaces the DB error', async () => {
    const sb = fakeSupabase(() => ({ error: { code: '42703' } }));
    await expect(writeTelephony(sb, 'biz1', 'native', null)).resolves.toEqual({ error: { code: '42703' } });
  });
});

// ---- presence --------------------------------------------------------------

describe('presence', () => {
  it('readPresence returns the stored status', async () => {
    const sb = fakeSupabase(() => ({ data: { status: 'busy', updated_at: 'x' }, error: null }));
    await expect(readPresence(sb, 'u1', 'biz1')).resolves.toBe('busy');
  });

  it('readPresence defaults to available when no row', async () => {
    const sb = fakeSupabase(() => ({ data: null, error: null }));
    await expect(readPresence(sb, 'u1', 'biz1')).resolves.toBe('available');
  });

  it('validatePresence rejects an unknown status', () => {
    expect(validatePresence({ status: 'lunch' })).toEqual({ ok: false, error: 'invalid_status' });
  });

  it('validatePresence accepts a known status', () => {
    expect(validatePresence({ status: ' dnd ' })).toEqual({ ok: true, status: 'dnd' });
  });

  it('writePresence surfaces the DB error', async () => {
    const sb = fakeSupabase(() => ({ error: { code: 'X' } }));
    await expect(writePresence(sb, 'u1', 'biz1', 'away')).resolves.toEqual({ error: { code: 'X' } });
  });
});

// ---- recording -------------------------------------------------------------

describe('recording', () => {
  it('isMissingColumn detects the pre-059 column error', () => {
    expect(isMissingColumn({ code: '42703' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumn({ message: 'column record_calls does not exist' })).toBe(true);
    expect(isMissingColumn({ code: 'other', message: 'nope' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
  });

  it('readRecording degrades to ON on a read error', async () => {
    const sb = fakeSupabase(() => ({ data: null, error: { code: '42703' } }));
    await expect(readRecording(sb, 'biz1')).resolves.toEqual({ degraded: true, recordCalls: true });
  });

  it('readRecording returns recordCalls=false only when explicitly false', async () => {
    const off = fakeSupabase(() => ({ data: { record_calls: false }, error: null }));
    const on = fakeSupabase(() => ({ data: { record_calls: null }, error: null }));
    await expect(readRecording(off, 'biz1')).resolves.toEqual({ degraded: false, recordCalls: false });
    await expect(readRecording(on, 'biz1')).resolves.toEqual({ degraded: false, recordCalls: true });
  });

  it('validateRecording requires a boolean', () => {
    expect(validateRecording({ recordCalls: 'yes' })).toEqual({ ok: false, error: 'invalid_record_calls' });
    expect(validateRecording({ recordCalls: true })).toEqual({ ok: true, recordCalls: true });
  });

  it('writeRecording classifies a missing column as migrationPending', async () => {
    const sb = fakeSupabase(() => ({ error: { code: '42703' } }));
    await expect(writeRecording(sb, 'biz1', true)).resolves.toEqual({ ok: false, migrationPending: true });
  });

  it('writeRecording reports a generic failure for other errors', async () => {
    const sb = fakeSupabase(() => ({ error: { code: 'XYZ', message: 'boom' } }));
    await expect(writeRecording(sb, 'biz1', false)).resolves.toEqual({ ok: false, migrationPending: false });
  });

  it('writeRecording reports ok on success', async () => {
    const sb = fakeSupabase(() => ({ error: null }));
    await expect(writeRecording(sb, 'biz1', true)).resolves.toEqual({ ok: true });
  });
});
