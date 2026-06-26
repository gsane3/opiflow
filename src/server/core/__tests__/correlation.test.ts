import { describe, it, expect } from 'vitest';
import { newCorrelationId, startOperation, opLog } from '../correlation';

describe('correlation', () => {
  it('generates distinct, uuid-shaped ids', () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('startOperation carries the fields plus a correlationId', () => {
    const op = startOperation({ businessId: 'b1', flow: 'inbound_call' });
    expect(op.businessId).toBe('b1');
    expect(op.flow).toBe('inbound_call');
    expect(typeof op.correlationId).toBe('string');
  });

  it('opLog exposes info/warn/error bound to the context', () => {
    const logger = opLog(startOperation({ businessId: 'b1' }));
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    // Should not throw when emitting.
    expect(() => logger.info('hello', { step: 1 })).not.toThrow();
  });
});
