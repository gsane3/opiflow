'use client';

// «Προτεινόμενη ενέργεια» — the single Next Best Action card (CAM v1).
//
// Shows EXACTLY ONE recommended action for a work folder (or a customer with no
// folder). Self-contained: it fetches the recommendation, renders one card, and
// owns the «Όχι τώρα» (dismiss) / «Υπενθύμισέ μου αργότερα» (snooze) lifecycle via
// PATCH. «Εκτέλεση» delegates to the host (onExecute) which opens the matching,
// already-implemented flow — nothing is auto-sent to the customer. Renders nothing
// for no_action / null (and degrades gracefully before migration 054 is applied).

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { OpfIcon } from '@/components/opf/icon';

export type NextActionType =
  | 'create_work_folder' | 'share_folder_link' | 'request_photos' | 'request_customer_details'
  | 'create_offer' | 'schedule_appointment' | 'send_follow_up' | 'reply_to_customer'
  | 'mark_work_done' | 'no_action';

interface ClientNextAction {
  id: string | null;
  actionType: NextActionType;
  title: string;
  explanation: string;
  confidence: number | null;
  dueAt: string | null;
  persistent: boolean;
}

const ACTION_ICON: Record<NextActionType, string> = {
  create_work_folder: 'folderPlus',
  share_folder_link: 'share',
  request_photos: 'image',
  request_customer_details: 'clipboard',
  create_offer: 'file',
  schedule_appointment: 'calendar',
  send_follow_up: 'send',
  reply_to_customer: 'message',
  mark_work_done: 'check',
  no_action: 'sparkles',
};

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}

export default function NextActionCard({
  endpoint, refreshKey = 0, onExecute, onLoaded,
}: {
  /** Base next-action endpoint, e.g. `/api/folders/{id}/next-action`. */
  endpoint: string;
  /** Bump to re-fetch (e.g. after an action changes folder state). */
  refreshKey?: number;
  /** Open the matching existing flow for this action type. */
  onExecute: (actionType: NextActionType) => void;
  /** Fired after each GET resolves — lets a sibling (AttentionCard) read the
   *  freshly-persisted next_actions row, avoiding a state contradiction. */
  onLoaded?: () => void;
}) {
  const [action, setAction] = useState<ClientNextAction | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(endpoint, { headers });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; action?: ClientNextAction | null };
      if (res.ok && json?.ok && json.action && json.action.actionType !== 'no_action') {
        setAction(json.action);
        setHidden(false);
      } else {
        setAction(null);
      }
    } catch { /* non-fatal — the card simply doesn't show */ }
    finally { onLoadedRef.current?.(); }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function patch(lifecycle: 'accept' | 'dismiss' | 'snooze') {
    if (!action?.id) return; // computed-only (pre-migration) → local-only
    try {
      const headers = await authHeaders();
      if (!headers) return;
      await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ id: action.id, action: lifecycle }) });
    } catch { /* best-effort */ }
  }

  function execute() {
    if (!action) return;
    const t = action.actionType;
    void patch('accept');
    setHidden(true);
    onExecute(t);
  }
  async function dismiss() {
    setBusy(true);
    try { await patch('dismiss'); setHidden(true); } finally { setBusy(false); }
  }
  async function snooze() {
    setBusy(true);
    try { await patch('snooze'); setHidden(true); } finally { setBusy(false); }
  }

  if (!action || hidden) return null;

  return (
    <div
      className="opf-card"
      style={{
        margin: '12px 0', padding: 16, borderRadius: 18,
        background: 'color-mix(in srgb, var(--brand) 7%, var(--bg))',
        border: '1px solid color-mix(in srgb, var(--brand) 28%, transparent)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <OpfIcon name="sparkles" size={16} color="var(--brand)" stroke={2} />
        <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.3, color: 'var(--brand)', textTransform: 'uppercase' }}>
          Προτεινόμενη ενέργεια
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <OpfIcon name={ACTION_ICON[action.actionType] ?? 'sparkles'} size={22} color="#fff" stroke={2.1} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.25 }}>{action.title}</div>
          {action.explanation && (
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 3 }}>{action.explanation}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <button
          className="opf-btn-primary opf-press"
          onClick={execute}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', fontSize: 14.5 }}
        >
          <OpfIcon name="arrowR" size={17} color="#fff" stroke={2.2} /><span>Εκτέλεση</span>
        </button>
        <button
          className="opf-press"
          onClick={() => void dismiss()}
          disabled={busy}
          style={{ padding: '10px 12px', fontSize: 13.5, fontWeight: 700, color: 'var(--muted)', background: 'transparent', borderRadius: 12 }}
        >
          Όχι τώρα
        </button>
        <button
          className="opf-press"
          onClick={() => void snooze()}
          disabled={busy}
          title="Υπενθύμισέ μου αργότερα"
          aria-label="Υπενθύμισέ μου αργότερα"
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '10px 12px', fontSize: 13, fontWeight: 700, color: 'var(--brand)', background: 'transparent', borderRadius: 12 }}
        >
          <OpfIcon name="clock" size={16} color="var(--brand)" stroke={2} /><span>Αργότερα</span>
        </button>
      </div>
    </div>
  );
}
