// Shared end-of-call intake prompt. On a call (inbound answered or outbound
// completed) to a number that is NOT yet a named customer, ask whether to send
// the customer-details request. Used by both the dialer (outbound) and the
// incoming-call modal (inbound) so the behaviour is identical everywhere.
//
// A small in-memory dedup window prevents nagging the same number twice in quick
// succession (e.g. an immediate call-back).

import { Alert } from 'react-native';

import { apiGet, apiPost } from '@/lib/api';

const last10 = (s?: string | null) => (s ? s.replace(/\D/g, '').slice(-10) : '');

// last-10-digits → timestamp(ms) of the last prompt. Skip re-prompting within 5'.
const recentlyPrompted = new Map<string, number>();
const DEDUP_MS = 5 * 60 * 1000;

// Finds an existing customer for this number (last-10-digit match) or creates one,
// then sends the intake link (Viber → SMS).
export async function sendIntakeForNumber(number: string, onDone?: () => void): Promise<void> {
  const digits = last10(number);
  try {
    let id: string | null = null;
    try {
      const found = await apiGet<{ customers?: Array<{ id: string; phone?: string | null; mobilePhone?: string | null }> }>(
        `/api/customers?q=${encodeURIComponent(number)}&limit=5`,
      );
      id = (found?.customers ?? []).find(
        (cu) => last10(cu.phone) === digits || last10(cu.mobilePhone) === digits,
      )?.id ?? null;
    } catch {
      // ignore — fall through to create
    }
    if (!id) {
      const created = await apiPost<{ customer?: { id: string } }>('/api/customers', { phone: number, source: 'manual_entry' });
      id = created?.customer?.id ?? null;
    }
    if (!id) { Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε επαφή.'); return; }
    const r = await apiPost<{ sent?: boolean }>(`/api/customers/${id}/intake-link`, { mode: 'send' });
    Alert.alert(r?.sent ? '✓' : 'Αποστολή', r?.sent ? 'Στάλθηκε αίτημα στοιχείων.' : 'Δεν στάλθηκε (λείπει κινητό; βάλε στοιχεία χειροκίνητα).');
    onDone?.();
  } catch {
    Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε.');
  }
}

// End-of-call popup: for a not-yet-named number, ALWAYS ask whether to send the
// details request. Skips numbers that already belong to a named customer, blanks,
// and numbers prompted in the last 5 minutes. «Όχι» does nothing.
export async function maybePromptIntakeFor(number: string, onDone?: () => void): Promise<void> {
  const digits = last10(number);
  if (digits.length < 8) return; // not a real dialable number (e.g. "Άγνωστος")

  const now = Date.now();
  const last = recentlyPrompted.get(digits);
  if (last && now - last < DEDUP_MS) return;

  try {
    const found = await apiGet<{ customers?: Array<{ id: string; name?: string | null; phone?: string | null; mobilePhone?: string | null }> }>(
      `/api/customers?q=${encodeURIComponent(number)}&limit=5`,
    );
    const known = (found?.customers ?? []).find(
      (cu) => (last10(cu.phone) === digits || last10(cu.mobilePhone) === digits) && !!cu.name?.trim(),
    );
    if (known) return; // already a named customer → no nag
  } catch {
    // ignore — still offer
  }

  recentlyPrompted.set(digits, now);
  Alert.alert(
    'Να σταλεί αίτημα αποστολής στοιχείων;',
    'Αν η επαφή δεν έχει Viber, θα σταλεί αυτόματα SMS. Αν είναι σταθερό, θα πρέπει να βάλεις τα στοιχεία χειροκίνητα.',
    [
      { text: 'Όχι', style: 'cancel' },
      { text: 'Ναι', onPress: () => void sendIntakeForNumber(number, onDone) },
    ],
  );
}
