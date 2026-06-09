// Call-brief timeline writer (migration 038: public.call_briefs).
//
// Each call can produce more than one brief over its lifetime: a metadata brief
// at log time, then a richer transcript brief once a recording is processed.
// Historically the second OVERWROTE the first in communications.summary, so the
// per-customer "journey across calls" was lost. We now ALSO append every brief to
// the append-only call_briefs table, keyed by communication + customer, so the
// redesign's brief timeline can show the full progression.
//
// Best-effort + non-fatal by design: brief history is supplementary (the latest
// brief still lives in communications.summary), so a failure here — including the
// table not existing yet, pre-038 — must NEVER break call logging or the recording
// pipeline. Every call is wrapped so it can only ever no-op.

import type { SupabaseClient } from '@supabase/supabase-js';

export type CallBriefKind = 'metadata' | 'transcript';

export async function appendCallBrief(
  supabase: SupabaseClient,
  params: {
    businessId: string;
    customerId?: string | null;
    communicationId?: string | null;
    briefKind: CallBriefKind;
    briefText: string | null | undefined;
  },
): Promise<void> {
  const text = (params.briefText ?? '').trim();
  if (!text || !params.businessId) return;
  try {
    await supabase.from('call_briefs').insert({
      business_id: params.businessId,
      customer_id: params.customerId ?? null,
      communication_id: params.communicationId ?? null,
      brief_kind: params.briefKind,
      brief_text: text,
    });
  } catch {
    // non-fatal — the brief also lives in communications.summary
  }
}
