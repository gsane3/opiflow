import { createServerSupabaseClient } from '@/lib/supabase/server';

// Best-effort audit logging. NEVER throws — auditing must not break the action.
// Writes to the audit_events table (see supabase migration). No-ops cleanly if
// the table doesn't exist yet.
export async function recordAuditEvent(opts: {
  businessId: string;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = createServerSupabaseClient();
    await supabase.from('audit_events').insert({
      business_id: opts.businessId,
      actor_user_id: opts.actorUserId ?? null,
      action: opts.action,
      entity_type: opts.entityType ?? null,
      entity_id: opts.entityId ?? null,
      metadata: opts.metadata ?? null,
    });
  } catch {
    // swallow
  }
}
