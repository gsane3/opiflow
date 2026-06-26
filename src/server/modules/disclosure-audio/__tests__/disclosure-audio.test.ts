import { describe, it, expect } from 'vitest';
import {
  getAudio,
  putAudio,
  MAX_AUDIO_DATAURL_LEN,
  AUDIO_DATAURL_RE,
} from '../disclosure-audio.service';
import { isMissingColumn } from '../disclosure-audio.repo';

// Hermetic fake of the Supabase service client. Only the `businesses` table is queried
// here, keyed by its PK id (no business_id column → NOT tenantDb). `resolve(ops)` lets a
// test decide what the .maybeSingle()/update() resolves to based on the recorded chain.
type ChainResult = { data?: unknown; error?: unknown };
function fakeCtx(resolve: (op: 'select' | 'update', ops: Record<string, unknown>) => ChainResult) {
  const supabase = {
    from(table: string) {
      const ops: Record<string, unknown> = { table };
      const builder: Record<string, unknown> = {
        select(cols: string) { ops.select = cols; return builder; },
        update(vals: unknown) { ops.update = vals; return builder; },
        eq(col: string, val: unknown) { ops.eqCol = col; ops.eqVal = val; return builder; },
        maybeSingle() { return Promise.resolve(resolve('select', ops)); },
        then(onF: (r: ChainResult) => unknown) {
          // bare `await update(...).eq(...)` (no maybeSingle) resolves here.
          return Promise.resolve(resolve('update', ops)).then(onF);
        },
      };
      return builder;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, businessId: 'b1' };
}

const VALID_DATAURL = 'data:audio/mp4;codecs="mp4a.40.2";base64,AAAA';

describe('AUDIO_DATAURL_RE (parity)', () => {
  it('accepts audio/* with quoted codec params', () => {
    expect(AUDIO_DATAURL_RE.test(VALID_DATAURL)).toBe(true);
    expect(AUDIO_DATAURL_RE.test('data:audio/webm;base64,AAAA')).toBe(true);
    expect(AUDIO_DATAURL_RE.test('data:audio/ogg;codecs=opus;base64,AB+/=')).toBe(true);
  });
  it('rejects non-audio / malformed data URLs', () => {
    expect(AUDIO_DATAURL_RE.test('data:image/png;base64,AAAA')).toBe(false);
    expect(AUDIO_DATAURL_RE.test('data:audio/mp4,AAAA')).toBe(false); // no ;base64
    expect(AUDIO_DATAURL_RE.test('not a data url')).toBe(false);
  });
});

describe('putAudio validation (parity, pre-storage)', () => {
  // These throws happen BEFORE any DB call, so they stay hermetic.
  const ctx = fakeCtx(() => ({ error: null }));

  it('rejects an oversized base64 string with audio_too_large 400', async () => {
    const big = 'data:audio/mp4;base64,' + 'A'.repeat(MAX_AUDIO_DATAURL_LEN);
    await expect(putAudio(ctx, big)).rejects.toMatchObject({ code: 'audio_too_large', status: 400 });
  });
  it('rejects a malformed (non-audio) data URL with invalid_audio 400', async () => {
    await expect(putAudio(ctx, 'data:image/png;base64,AAAA')).rejects.toMatchObject({ code: 'invalid_audio', status: 400 });
    await expect(putAudio(ctx, 'hello')).rejects.toMatchObject({ code: 'invalid_audio', status: 400 });
  });
  it('rejects a non-string, non-null/empty value with invalid_audio 400', async () => {
    await expect(putAudio(ctx, 123)).rejects.toMatchObject({ code: 'invalid_audio', status: 400 });
    await expect(putAudio(ctx, { foo: 1 })).rejects.toMatchObject({ code: 'invalid_audio', status: 400 });
  });
});

describe('putAudio storage outcomes (parity)', () => {
  it('clears the clip on null and reports configured:false', async () => {
    let savedValue: unknown;
    const ctx = fakeCtx((op, ops) => {
      if (op === 'update') savedValue = (ops.update as Record<string, unknown>).recording_disclosure_audio;
      return { error: null };
    });
    await expect(putAudio(ctx, null)).resolves.toEqual({ configured: false });
    expect(savedValue).toBeNull();
  });
  it('clears the clip on empty string and reports configured:false', async () => {
    const ctx = fakeCtx(() => ({ error: null }));
    await expect(putAudio(ctx, '')).resolves.toEqual({ configured: false });
  });
  it('stores a valid clip and reports configured:true', async () => {
    let savedValue: unknown;
    const ctx = fakeCtx((op, ops) => {
      if (op === 'update') savedValue = (ops.update as Record<string, unknown>).recording_disclosure_audio;
      return { error: null };
    });
    await expect(putAudio(ctx, VALID_DATAURL)).resolves.toEqual({ configured: true });
    expect(savedValue).toBe(VALID_DATAURL);
  });
  it('reports migrationPending when the column is absent (pre-055)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '42703', message: 'column recording_disclosure_audio does not exist' } }));
    await expect(putAudio(ctx, VALID_DATAURL)).resolves.toEqual({ migrationPending: true });
  });
  it('throws update_failed 500 on a generic DB error', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '500', message: 'boom' } }));
    await expect(putAudio(ctx, VALID_DATAURL)).rejects.toMatchObject({ code: 'update_failed', status: 500 });
  });
});

describe('getAudio outcomes (parity)', () => {
  it('returns audio + configured:true when set', async () => {
    const ctx = fakeCtx(() => ({ data: { recording_disclosure_audio: VALID_DATAURL }, error: null }));
    await expect(getAudio(ctx)).resolves.toEqual({ audio: VALID_DATAURL, configured: true });
  });
  it('returns null + configured:false when unset', async () => {
    const ctx = fakeCtx(() => ({ data: { recording_disclosure_audio: null }, error: null }));
    await expect(getAudio(ctx)).resolves.toEqual({ audio: null, configured: false });
  });
  it('returns null + configured:false when the row is missing', async () => {
    const ctx = fakeCtx(() => ({ data: null, error: null }));
    await expect(getAudio(ctx)).resolves.toEqual({ audio: null, configured: false });
  });
  it('reports migrationPending when the column is absent (pre-055)', async () => {
    const ctx = fakeCtx(() => ({ error: { code: 'PGRST204', message: 'no column' } }));
    await expect(getAudio(ctx)).resolves.toEqual({ migrationPending: true });
  });
  it('throws query_failed 500 on a generic DB error', async () => {
    const ctx = fakeCtx(() => ({ error: { code: '500', message: 'boom' } }));
    await expect(getAudio(ctx)).rejects.toMatchObject({ code: 'query_failed', status: 500 });
  });
});

describe('isMissingColumn (parity)', () => {
  it('flags 42703 / PGRST204 / the column name', () => {
    expect(isMissingColumn({ code: '42703' })).toBe(true);
    expect(isMissingColumn({ code: 'PGRST204' })).toBe(true);
    expect(isMissingColumn({ message: 'relation recording_disclosure_audio missing' })).toBe(true);
  });
  it('does not flag an unrelated error or null', () => {
    expect(isMissingColumn({ code: '500', message: 'boom' })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn(undefined)).toBe(false);
  });
});
