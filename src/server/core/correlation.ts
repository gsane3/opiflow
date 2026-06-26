// Correlation IDs — trace one logical operation across many structured log lines.
//
// PR foundation (unwired). Generate a correlation id at each entry point
// (route / webhook / job), thread it through the operation, and emit logs via
// opLog so the whole chain (e.g. PBX webhook → recording → Deepgram → brief →
// notify) is greppable by a single id. Overview §10, point #19.

import { randomUUID } from 'node:crypto';
import { log } from '../../lib/observability';

export function newCorrelationId(): string {
  return randomUUID();
}

export interface OperationContext {
  correlationId: string;
  [key: string]: unknown;
}

/** Start an operation with a fresh correlation id plus any stable fields. */
export function startOperation(fields: Record<string, unknown> = {}): OperationContext {
  return { correlationId: newCorrelationId(), ...fields };
}

/** Structured loggers that always carry the operation's correlation context. */
export function opLog(ctx: OperationContext) {
  return {
    info: (message: string, extra?: Record<string, unknown>) =>
      log.info(message, { ...ctx, ...extra }),
    warn: (message: string, extra?: Record<string, unknown>) =>
      log.warn(message, { ...ctx, ...extra }),
    error: (message: string, extra?: Record<string, unknown>) =>
      log.error(message, { ...ctx, ...extra }),
  };
}
