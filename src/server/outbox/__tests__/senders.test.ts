import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildOutboxSenders, type OutboxSenderDeps } from '../senders';
import type { OutboxRow } from '../outbox';

function row(kind: string, payload: unknown, businessId: string | null = 'b1'): OutboxRow {
  return {
    id: 'e1', business_id: businessId, kind, dedup_key: null, payload,
    status: 'processing', attempts: 0, next_retry_at: '', last_error: null,
    sent_at: null, created_at: '', updated_at: '',
  };
}

function deps(over: Partial<OutboxSenderDeps> = {}): OutboxSenderDeps {
  return {
    sendMessage: vi.fn(async () => ({ ok: true, channel: 'viber' })),
    sendPush: vi.fn(async () => ({})),
    ...over,
  };
}

describe('outbox senders', () => {
  it('viber/sms/message route to sendMessage with the payload fields', async () => {
    const d = deps();
    const senders = buildOutboxSenders(d);
    await senders.viber(row('viber', { text: 'γεια', phone: '+30690', preferred: 'viber', customerId: 'c1' }));
    expect(d.sendMessage).toHaveBeenCalledWith({
      preferred: 'viber', phone: '+30690', text: 'γεια', customerId: 'c1', referenceId: null,
    });
    // same sender backs all three kinds
    expect(senders.sms).toBe(senders.message);
    expect(senders.viber).toBe(senders.message);
  });

  it('message sender THROWS when text is missing (→ worker retries)', async () => {
    const senders = buildOutboxSenders(deps());
    await expect(senders.message(row('message', { phone: '+30690' }))).rejects.toThrow(/missing 'text'/);
  });

  it('message sender THROWS when the send is not ok (→ retry/dead-letter)', async () => {
    const d = deps({ sendMessage: vi.fn(async () => ({ ok: false, channel: 'none' })) });
    const senders = buildOutboxSenders(d);
    await expect(senders.message(row('message', { text: 'x' }))).rejects.toThrow(/send failed/);
  });

  it('push sender calls sendPush with business id + content', async () => {
    const d = deps();
    const senders = buildOutboxSenders(d);
    await senders.push(row('push', { title: 'T', body: 'B', url: '/calls' }));
    expect(d.sendPush).toHaveBeenCalledWith('b1', { title: 'T', body: 'B', url: '/calls' });
  });

  it('push sender THROWS when business_id is missing', async () => {
    const senders = buildOutboxSenders(deps());
    await expect(senders.push(row('push', { title: 'T', body: 'B' }, null))).rejects.toThrow(/business_id/);
  });

  describe('webhook sender', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 }))));
    afterEach(() => vi.unstubAllGlobals());

    it('POSTs to the payload url', async () => {
      const senders = buildOutboxSenders(deps());
      await senders.webhook(row('webhook', { url: 'https://hook.test/x', body: { a: 1 } }));
      expect(fetch).toHaveBeenCalledWith('https://hook.test/x', expect.objectContaining({ method: 'POST' }));
    });

    it('THROWS on a non-2xx response (→ retry)', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
      const senders = buildOutboxSenders(deps());
      await expect(senders.webhook(row('webhook', { url: 'https://hook.test/x' }))).rejects.toThrow(/HTTP 503/);
    });

    it('THROWS when url is missing', async () => {
      const senders = buildOutboxSenders(deps());
      await expect(senders.webhook(row('webhook', {}))).rejects.toThrow(/missing 'url'/);
    });
  });
});
