import { describe, it, expect, vi } from 'vitest';
import { sendTestPush, type TestPushDeps } from '../push.service';

describe('sendTestPush (parity)', () => {
  it('returns { configured: false } and does not send when push is disabled', async () => {
    const send = vi.fn() as unknown as NonNullable<TestPushDeps['sendPushToUser']>;
    const outcome = await sendTestPush('u1', { isPushEnabled: () => false, sendPushToUser: send });
    expect(outcome).toEqual({ configured: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends to the caller and returns the sender result when push is enabled', async () => {
    const send = vi.fn(async () => ({ sent: 2, failed: 0 })) as unknown as NonNullable<TestPushDeps['sendPushToUser']>;
    const outcome = await sendTestPush('u1', { isPushEnabled: () => true, sendPushToUser: send });
    expect(outcome).toEqual({ configured: true, result: { sent: 2, failed: 0 } });
    expect(send).toHaveBeenCalledWith('u1', expect.objectContaining({ title: 'Opiflow', url: '/', data: { type: 'test' } }));
  });
});
