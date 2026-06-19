import { describe, it, expect, beforeEach, vi } from 'vitest';

// ONE durable link per project: getOrCreateFolderToken must REUSE the folder's
// canonical link (work_folders.portal_url, which stores the full /f/<token> URL)
// while its token is live, and only mint + store a new one when none is live — and
// it must NEVER revoke. A tiny table-aware fake Supabase records inserts/updates so
// we can assert "reused vs minted".

const state: {
  responses: Record<string, { data: unknown; error: unknown }>;
  log: { inserts: { table: string }[]; updates: { table: string; p: Record<string, unknown> }[] };
} = { responses: {}, log: { inserts: [], updates: [] } };

function fakeClient() {
  const b: Record<string, unknown> = {};
  let table = '';
  let op = 'select';
  Object.assign(b, {
    from: (t: string) => { table = t; op = 'select'; return b; },
    select: () => b,
    insert: (p: Record<string, unknown>) => { op = 'insert'; state.log.inserts.push({ table, ...p }); return b; },
    update: (p: Record<string, unknown>) => { op = 'update'; state.log.updates.push({ table, p }); return b; },
    eq: () => b, in: () => b, gt: () => b, is: () => b, not: () => b,
    order: () => b, limit: () => b, maybeSingle: () => b, single: () => b,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const key = `${table}.${op}`;
      op = 'select';
      return Promise.resolve(state.responses[key] ?? { data: null, error: null }).then(res, rej);
    },
  });
  return b;
}

vi.mock('../intake-tokens', () => ({
  createServiceSupabaseClient: () => fakeClient(),
  getPublicAppUrl: () => 'https://app.example',
}));

import { getOrCreateFolderToken } from '../folder-tokens';

const cftInserts = () => state.log.inserts.filter((r) => r.table === 'customer_folder_tokens');

describe('getOrCreateFolderToken (one durable link via portal_url)', () => {
  beforeEach(() => { state.responses = {}; state.log = { inserts: [], updates: [] }; });

  it('reuses the canonical portal_url link while its token is live — same URL, no new token', async () => {
    state.responses['work_folders.select'] = { data: { portal_url: 'https://app.example/f/REUSETOKEN' }, error: null };
    state.responses['customer_folder_tokens.select'] = {
      data: { id: 'tokLive', token_hash: 'h', business_id: 'b', work_folder_id: 'f', status: 'sent', expires_at: '2999-01-01T00:00:00Z', revoked_at: null },
      error: null,
    };
    state.responses['customer_folder_tokens.update'] = { data: null, error: null };

    const r = await getOrCreateFolderToken({ businessId: 'b', workFolderId: 'f' });

    expect(r.folderUrl).toBe('https://app.example/f/REUSETOKEN');
    expect(r.rawToken).toBe('REUSETOKEN');
    expect(cftInserts()).toHaveLength(0); // reused — never minted a new token
  });

  it('mints + stores a new portal_url when none exists', async () => {
    state.responses['work_folders.select'] = { data: { portal_url: null }, error: null };
    state.responses['customer_folder_tokens.insert'] = { data: { id: 'tokNew', token_hash: 'h2' }, error: null };
    state.responses['work_folders.update'] = { data: null, error: null };

    const r = await getOrCreateFolderToken({ businessId: 'b', workFolderId: 'f' });

    expect(cftInserts()).toHaveLength(1); // minted
    const stored = state.log.updates.find((u) => u.table === 'work_folders');
    expect(stored?.p.portal_url).toBe(r.folderUrl); // canonical link persisted
    expect(r.folderUrl).toBe(`https://app.example/f/${r.rawToken}`);
  });

  it('mints a fresh link when the stored portal_url token is dead (revoked/expired)', async () => {
    state.responses['work_folders.select'] = { data: { portal_url: 'https://app.example/f/DEADTOKEN' }, error: null };
    state.responses['customer_folder_tokens.select'] = { data: null, error: null }; // findValidFolderToken → not live
    state.responses['customer_folder_tokens.insert'] = { data: { id: 'tokNew2', token_hash: 'h3' }, error: null };
    state.responses['work_folders.update'] = { data: null, error: null };

    const r = await getOrCreateFolderToken({ businessId: 'b', workFolderId: 'f' });

    expect(cftInserts()).toHaveLength(1);
    expect(r.rawToken).not.toBe('DEADTOKEN');
    expect(state.log.updates.some((u) => u.table === 'work_folders' && u.p.portal_url === r.folderUrl)).toBe(true);
  });
});
