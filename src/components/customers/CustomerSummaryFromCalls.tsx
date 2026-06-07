'use client';

// "Σύνοψη από κλήσεις" — wires the (previously unwired) /api/ai/customer-memory
// endpoint into the customer card. One tap consolidates the recent call briefs +
// tasks + offers into a proposed status summary, business notes, and the single
// most-recent NEXT ACTION. Review-first: nothing is written until the user taps
// "Αποδοχή", which PATCHes the customer's memory fields (already rendered on the card).

import { useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

interface Suggestion {
  proposedStatusSummary: string | null;
  proposedBusinessNotes: string | null;
  proposedPersonalNotes: string | null;
  proposedNextBestAction: string | null;
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
}

const CONF: Record<string, { text: string; cls: string }> = {
  high: { text: 'Υψηλή βεβαιότητα', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  medium: { text: 'Μέτρια βεβαιότητα', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  low: { text: 'Χαμηλή βεβαιότητα', cls: 'bg-zinc-100 text-zinc-600 ring-zinc-200' },
};

async function getToken(): Promise<string | null> {
  const supabase = createBrowserSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export default function CustomerSummaryFromCalls({
  customerId,
  onApplied,
}: {
  customerId: string;
  onApplied: (customer: unknown) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const generate = useCallback(async () => {
    setError(null);
    setEmpty(false);
    setSuggestion(null);
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) {
        setError('Πρέπει να είσαι συνδεδεμένος.');
        return;
      }
      const res = await fetch('/api/ai/customer-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ customerId, triggerEvent: 'manual' }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setError(
          json?.error === 'no_api_key'
            ? 'Το AI δεν είναι ρυθμισμένο ακόμα.'
            : json?.error === 'rate_limited'
              ? 'Πολλές προσπάθειες — δοκίμασε σε λίγο.'
              : 'Δεν ήταν δυνατή η δημιουργία σύνοψης.'
        );
        return;
      }
      const s = json.suggestion as Suggestion;
      const hasAny =
        s.proposedStatusSummary || s.proposedBusinessNotes || s.proposedPersonalNotes || s.proposedNextBestAction;
      if (!hasAny) {
        setEmpty(true);
        return;
      }
      setSuggestion(s);
    } catch {
      setError('Δεν ήταν δυνατή η δημιουργία σύνοψης.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  const accept = useCallback(async () => {
    if (!suggestion) return;
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError('Πρέπει να είσαι συνδεδεμένος.');
        return;
      }
      const body: Record<string, string> = {};
      if (suggestion.proposedStatusSummary) body.statusSummary = suggestion.proposedStatusSummary;
      if (suggestion.proposedBusinessNotes) body.businessNotes = suggestion.proposedBusinessNotes;
      if (suggestion.proposedPersonalNotes) body.personalNotes = suggestion.proposedPersonalNotes;
      if (suggestion.proposedNextBestAction) body.nextBestAction = suggestion.proposedNextBestAction;
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.customer) {
        setError('Η αποθήκευση απέτυχε.');
        return;
      }
      onApplied(json.customer);
      setSuggestion(null);
    } catch {
      setError('Η αποθήκευση απέτυχε.');
    } finally {
      setSaving(false);
    }
  }, [suggestion, customerId, onApplied]);

  const conf = suggestion ? CONF[suggestion.confidence] ?? CONF.low : null;

  return (
    <div className="pt-1">
      {!suggestion && (
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100 disabled:opacity-60"
        >
          <span aria-hidden>✨</span>
          {loading ? 'Δημιουργία σύνοψης…' : 'Σύνοψη από κλήσεις (AI)'}
        </button>
      )}
      {empty && (
        <p className="mt-2 text-xs text-zinc-400">Δεν υπάρχουν ακόμα αρκετά στοιχεία (κλήσεις/σημειώσεις) για σύνοψη.</p>
      )}
      {error && <p className="mt-2 text-xs text-amber-600">{error}</p>}

      {suggestion && conf && (
        <div className="mt-2 rounded-2xl bg-indigo-50/60 p-3 ring-1 ring-indigo-100">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-indigo-900">Πρόταση AI — έλεγξε πριν αποθηκεύσεις</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${conf.cls}`}>{conf.text}</span>
          </div>
          <div className="space-y-2">
            {suggestion.proposedNextBestAction && (
              <Field label="Επόμενη ενέργεια" value={suggestion.proposedNextBestAction} highlight />
            )}
            {suggestion.proposedStatusSummary && <Field label="Τρέχουσα κατάσταση" value={suggestion.proposedStatusSummary} />}
            {suggestion.proposedBusinessNotes && (
              <Field label="Επαγγελματικές σημειώσεις" value={suggestion.proposedBusinessNotes} />
            )}
            {suggestion.proposedPersonalNotes && <Field label="Προσωπικά" value={suggestion.proposedPersonalNotes} />}
          </div>
          {suggestion.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-amber-600">
              {suggestion.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={accept}
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Αποθήκευση…' : 'Αποδοχή & αποθήκευση'}
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              disabled={saving}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50"
            >
              Άκυρο
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-500">{label}</p>
      <p className={`whitespace-pre-wrap text-xs ${highlight ? 'font-semibold text-indigo-900' : 'text-zinc-700'}`}>{value}</p>
    </div>
  );
}
