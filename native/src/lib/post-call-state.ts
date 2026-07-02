// Global "a call just ended" store (same tiny pattern as twilio-state). The
// inbound path logs the call deep inside twilio.ts where no screen is mounted;
// this store lets a root-level host open the post-call action sheet with the
// fresh communicationId — parity with the outbound dialer's onLogged flow.

import type { Communication } from '@/lib/types';

type Listener = () => void;

let postCall: Communication | null = null;
const listeners = new Set<Listener>();

export function getPostCall(): Communication | null {
  return postCall;
}

export function setPostCall(next: Communication | null) {
  postCall = next;
  for (const fn of listeners) fn();
}

export function subscribePostCall(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
