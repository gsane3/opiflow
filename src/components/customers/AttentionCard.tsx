'use client';

// «Τι χρειάζεται τώρα» — the CAM Attention card (computed folder state, v1).
//
// Answers "who are we waiting on / what's the situation", complementing (not
// duplicating) the Next Best Action card below it: this is STATE-framed, the NBA
// card carries the ACTION. The only button here is the urgent reply shortcut
// (other actions live on the NBA card). Renders nothing when attention is null
// (closed/not-found folder) and fails gracefully on any fetch error.

import { useCallback, useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { OpfIcon } from '@/components/opf/icon';

type WaitingOn = 'business' | 'customer' | 'date' | 'none';
type Severity = 'info' | 'warning' | 'urgent';

interface ClientFolderAttention {
  waitingOn: WaitingOn;
  severity: Severity;
  label: string;
  explanation: string | null;
  dueAt: string | null;
  source: string;
  cta: { actionType: string; label: string } | null;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  urgent: 'var(--danger)',
  warning: '#E0922F',
  info: 'var(--brand)',
};

const WAITING_CHIP: Record<WaitingOn, string> = {
  business: 'Χρειάζεται ενέργεια',
  customer: 'Περιμένει ο πελάτης',
  date: 'Υπενθύμιση',
  none: 'Όλα εντάξει',
};

async function authHeaders(): Promise<Record<string, string> | null> {
  try {
    const supabase = createBrowserSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  } catch { return null; }
}

export default function AttentionCard({
  endpoint, refreshKey = 0, onExecute,
}: {
  endpoint: string;
  refreshKey?: number;
  onExecute: (actionType: string) => void;
}) {
  const [attention, setAttention] = useState<ClientFolderAttention | null>(null);

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch(endpoint, { headers });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; attention?: ClientFolderAttention | null };
      setAttention(res.ok && json?.ok && json.attention ? json.attention : null);
    } catch { /* non-fatal — card stays hidden */ }
  }, [endpoint]);

  // refreshKey is driven by the sibling NBA card's onLoaded, so attention is read
  // only AFTER the NBA GET has (re)computed/persisted its row — this prevents an
  // "all clear" state from contradicting a freshly-computed next action. We skip
  // the refreshKey===0 mount so the first fetch waits for that signal.
  useEffect(() => { if (refreshKey > 0) void load(); }, [load, refreshKey]);

  if (!attention) return null;
  const color = SEVERITY_COLOR[attention.severity];

  return (
    <div
      className="opf-card"
      style={{
        margin: '12px 0', padding: 14, borderRadius: 16,
        background: `color-mix(in srgb, ${color} 7%, var(--bg))`,
        border: `1px solid color-mix(in srgb, ${color} 26%, transparent)`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9 }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.3, color: 'var(--ink-2)', textTransform: 'uppercase' }}>
          Τι χρειάζεται τώρα
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color, background: `color-mix(in srgb, ${color} 14%, transparent)`, padding: '3px 8px', borderRadius: 999 }}>
          {WAITING_CHIP[attention.waitingOn]}
        </span>
      </div>

      <div style={{ fontSize: 15.5, fontWeight: 800, color: 'var(--ink)', lineHeight: 1.3 }}>{attention.label}</div>
      {attention.explanation && (
        <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 3 }}>{attention.explanation}</div>
      )}

      {attention.cta && (
        <button
          className="opf-btn-primary opf-press"
          onClick={() => onExecute(attention.cta!.actionType)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', fontSize: 14, marginTop: 12, background: color }}
        >
          <OpfIcon name="message" size={16} color="#fff" stroke={2.1} /><span>{attention.cta.label}</span>
        </button>
      )}
    </div>
  );
}
