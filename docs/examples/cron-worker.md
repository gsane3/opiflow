# Example: wiring the job queue + outbox into a cron worker

This is the **adoption** step for the (currently unwired) reliability layer
(`src/server/jobs`, `src/server/outbox`). It is shown as an example — **not** a live
route — so the build's route table stays unchanged until you choose to add it.

When you adopt it, create `src/app/api/cron/worker/route.ts`, add the schedule to
`vercel.json`, and gate it behind `CRON_SECRET` (already the pattern for the other
crons) plus a `WORKER_ENABLED` flag so it ships dormant.

```ts
// src/app/api/cron/worker/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkCronSecret } from '@/lib/server/cron-auth';
import { runDueJobs } from '@/server/jobs/queue';
import { dispatchOutbox } from '@/server/outbox/outbox';
import { sendViaPreferredChannel } from '@/lib/server/send-channel'; // existing adapter

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = checkCronSecret(request);          // fail-closed in prod
  if (denied) return denied;
  if (process.env.WORKER_ENABLED !== '1') {         // dormant until flipped
    return NextResponse.json({ ok: true, skipped: 'worker_disabled' });
  }

  const supabase = createServerSupabaseClient();

  // 1) Drain background jobs (transcription → AI brief → next-action), with retries.
  const jobs = await runDueJobs(supabase, {
    transcribe_and_brief: async (job) => { /* call the existing brief pipeline */ },
    generate_next_action: async (job) => { /* … */ },
  });

  // 2) Deliver queued outbound messages idempotently (no lost / double sends).
  const outbox = await dispatchOutbox(supabase, {
    viber: async (ev) => { await sendViaPreferredChannel(/* … from ev.payload */); },
    sms:   async (ev) => { await sendViaPreferredChannel(/* … */); },
    email: async (ev) => { /* Resend send */ },
  });

  return NextResponse.json({ ok: true, jobs, outbox });
}
```

```jsonc
// vercel.json — add the schedule (Vercel cron min granularity is daily on the
// current plan; use a per-minute external pinger or upgrade for tighter cadence).
{ "crons": [{ "path": "/api/cron/worker", "schedule": "0 * * * *" }] }
```

### How adoption stays zero-impact
- Ships with `WORKER_ENABLED` unset → the route returns `skipped` and does nothing.
- The webhooks keep doing the work inline until you (a) start **enqueuing** jobs /
  **recording** outbox events in those webhooks and (b) flip `WORKER_ENABLED=1`.
- Migration `063_outbox_events.sql` must be applied before recording outbox events
  (the code is tolerant until then).
