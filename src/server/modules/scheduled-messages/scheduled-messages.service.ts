// Scheduled messages — service. Parity-matched to /api/scheduled-messages/[id].
// The tenant-scoped "cancel a pending message" lives in the repo; this thin layer
// keeps the route shape consistent with the other adopted modules.

import { cancelScheduledMessageRow, type RepoContext } from './scheduled-messages.repo';

/** Cancel a pending scheduled message (no-op if already sent/cancelled or not found). */
export async function cancelScheduledMessage(ctx: RepoContext, id: string): Promise<void> {
  await cancelScheduledMessageRow(ctx, id);
}
