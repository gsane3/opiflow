// Per-call action sheet — mirrors the web calls-page bottom sheet:
// full AI brief + actions (call, view/link/add contact, create task, delete).

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipSelect, Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { hapticSuccess } from '@/lib/haptics';
import { formatWhen, todayYMD } from '@/lib/format';
import type { Communication, Customer } from '@/lib/types';

const TASK_TYPES: Array<{ key: string; label: string }> = [
  { key: 'call_back', label: 'Κλήση πίσω' },
  { key: 'send_offer', label: 'Αποστολή προσφοράς' },
  { key: 'book_appointment', label: 'Ραντεβού' },
  { key: 'other', label: 'Άλλο' },
];

// AI suggested-action type → task type for one-tap chip creation. request_* map
// to a plain task ("Ζήτα στοιχεία/φωτογραφίες") — the actual link-send happens
// later from the customer card (and needs a saved contact).
const ACTION_TASK_TYPE: Record<string, string> = {
  send_offer: 'send_offer',
  book_appointment: 'book_appointment',
  call_back: 'call_back',
  request_photos: 'other',
  request_details: 'other',
};

interface BriefStatus {
  ok?: boolean;
  ready?: boolean;
  summary?: string | null;
  suggestedActions?: Array<{ actionType: string; label: string }>;
}

/** Strip log markers, keep the human/AI text of the summary. */
function fullBrief(summary?: string | null): string {
  if (!summary) return '';
  return summary
    .split('\n')
    .filter((l) => !/^(uniqueid=|twilio_sid=)/.test(l.trim()))
    .join('\n')
    .trim();
}

function normalize(p?: string | null): string {
  if (!p) return '';
  const s = p.replace(/[\s\-().]/g, '');
  if (/^\+30\d{10}$/.test(s)) return s;
  if (/^30\d{10}$/.test(s)) return '+' + s;
  if (/^[26]\d{9}$/.test(s)) return '+30' + s;
  return s;
}

export function CallActionSheet({
  call,
  polling = false,
  onClose,
  onChanged,
  onOpenCustomer,
  onDial,
}: {
  call: Communication | null;
  /** Just-ended call: poll for the AI transcript brief + show a progress state. */
  polling?: boolean;
  onClose: () => void;
  /** The list changed (link/delete) — reload. */
  onChanged: () => void;
  onOpenCustomer: (customerId: string) => void;
  onDial: (phone: string) => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [view, setView] = useState<'actions' | 'add_contact' | 'create_task'>('actions');
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<Customer | null>(null);

  // Live AI brief (post-call): the dial-time row carries only a metadata brief;
  // the detailed transcript brief lands seconds later. Poll until it's ready.
  const [liveSummary, setLiveSummary] = useState<string | null>(null);
  const [actions, setActions] = useState<Array<{ actionType: string; label: string }>>([]);
  const [briefReady, setBriefReady] = useState(false);
  const [loadingBrief, setLoadingBrief] = useState(false);

  // add-contact form
  const [cName, setCName] = useState('');
  const [cCompany, setCCompany] = useState('');
  const [cEmail, setCEmail] = useState('');
  // task form
  const [tTitle, setTTitle] = useState('');
  const [tType, setTType] = useState('call_back');
  const [tNote, setTNote] = useState('');

  useEffect(() => {
    if (!call) return;
    setView('actions');
    setBusy(false);
    setMatch(null);
    setCName('');
    setCCompany('');
    setCEmail('');
    setTTitle(call.direction === 'inbound' && call.status !== 'completed' ? 'Κλήση πίσω' : 'Follow-up κλήσης');
    setTType('call_back');
    setTNote('');
    // Find an existing customer with the same phone (for «Σύνδεση με υπάρχουσα»).
    // Server-side search — the old fetch-100-and-scan approach silently missed
    // matches (→ duplicate contacts) once the CRM passed 100 customers.
    if (!call.customerId && call.phone) {
      const target = normalize(call.phone);
      const q = target.replace(/^\+30/, '');
      apiGet<{ customers?: Customer[] }>(`/api/customers?q=${encodeURIComponent(q)}&limit=10`)
        .then((res) => {
          const found = (res?.customers ?? []).find((c) =>
            [c.phone, c.mobilePhone, c.landlinePhone].some((p) => p && normalize(p) === target),
          );
          if (found) setMatch(found);
        })
        .catch(() => {});
    }
  }, [call]);

  // Fetch (and, for a just-ended call, poll) the AI brief + suggested chips.
  // One immediate fetch always runs (so chips show when opened from history);
  // when `polling`, it retries every 2.5 s until the transcript brief is ready
  // or ~30 s elapse.
  useEffect(() => {
    setLiveSummary(null);
    setActions([]);
    setBriefReady(false);
    const callId = call?.id;
    if (!callId) {
      setLoadingBrief(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setLoadingBrief(true);

    const poll = async () => {
      attempts += 1;
      let ready = false;
      try {
        const r = await apiGet<BriefStatus>(`/api/calls/${callId}/brief`);
        if (cancelled) return;
        if (r?.summary) setLiveSummary(r.summary);
        if (Array.isArray(r?.suggestedActions)) setActions(r.suggestedActions);
        ready = Boolean(r?.ready);
        if (ready) setBriefReady(true);
      } catch {
        // transient — retry until maxAttempts
      }
      if (cancelled) return;
      if (ready || !polling || attempts >= maxAttempts) {
        setLoadingBrief(false);
        return;
      }
      timer = setTimeout(() => void poll(), 2500);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [call, polling]);

  if (!call) return null;

  const brief = fullBrief(liveSummary ?? call.summary);
  const name = call.customer?.name ?? null;

  // One-tap: turn an AI-suggested action into a task for this call's customer.
  async function runAction(a: { actionType: string; label: string }) {
    setBusy(true);
    try {
      await apiPost('/api/tasks', {
        customerId: call!.customerId ?? undefined,
        title: a.label,
        type: ACTION_TASK_TYPE[a.actionType] ?? 'other',
        status: 'open',
        dueDate: todayYMD(),
        note: 'Από AI brief κλήσης',
      });
      setActions((prev) => prev.filter((x) => x.actionType !== a.actionType));
      onChanged();
      void hapticSuccess();
      Alert.alert('✓', `Προστέθηκε εργασία: ${a.label}`);
    } catch {
      Alert.alert('Σφάλμα', 'Η εργασία δεν δημιουργήθηκε.');
    } finally {
      setBusy(false);
    }
  }

  async function linkTo(customerId: string) {
    setBusy(true);
    try {
      await apiPatch(`/api/communications?id=${call!.id}`, { customerId });
      onChanged();
      onClose();
    } catch {
      Alert.alert('Σφάλμα', 'Η σύνδεση απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  async function addContact() {
    if (!cName.trim() && !cCompany.trim()) {
      Alert.alert('Επαφή', 'Συμπλήρωσε όνομα ή εταιρεία.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; customer?: { id: string } }>('/api/customers', {
        name: cName.trim() || null,
        companyName: cCompany.trim() || null,
        email: cEmail.trim() || null,
        phone: call!.phone,
        source: 'inbound_call',
      });
      if (res?.customer?.id) {
        const newId = res.customer.id;
        await apiPatch(`/api/communications?id=${call!.id}`, { customerId: newId });
        onChanged();
        // Post-call intake prompt: now that we have a contact for this number,
        // offer to immediately ask them for their job details (Viber → SMS).
        // Useful both ways — an unknown number we just called or that called us.
        Alert.alert('Να σταλεί αίτημα αποστολής στοιχείων;', 'Αν η επαφή δεν έχει Viber, θα σταλεί αυτόματα SMS. Αν είναι σταθερό, θα πρέπει να βάλεις τα στοιχεία χειροκίνητα.', [
          { text: 'Όχι', style: 'cancel', onPress: onClose },
          {
            text: 'Ναι',
            onPress: async () => {
              try {
                const r = await apiPost<{ sent?: boolean; error?: string }>(`/api/customers/${newId}/intake-link`, { mode: 'send' });
                Alert.alert(r?.sent ? '✓' : 'Αποστολή', r?.sent ? 'Στάλθηκε αίτημα στοιχείων.' : 'Δεν στάλθηκε (λείπει κινητό; βάλε στοιχεία χειροκίνητα).');
              } catch {
                Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε.');
              } finally {
                onClose();
              }
            },
          },
        ]);
      } else {
        Alert.alert('Σφάλμα', 'Η επαφή δεν δημιουργήθηκε.');
      }
    } catch {
      Alert.alert('Σφάλμα', 'Η επαφή δεν δημιουργήθηκε.');
    } finally {
      setBusy(false);
    }
  }

  async function createTask() {
    if (!tTitle.trim()) return;
    setBusy(true);
    try {
      await apiPost('/api/tasks', {
        customerId: call!.customerId ?? undefined,
        title: tTitle.trim(),
        type: tType,
        status: 'open',
        dueDate: todayYMD(),
        note: tNote.trim() || null,
      });
      onClose();
    } catch {
      Alert.alert('Σφάλμα', 'Η εργασία δεν δημιουργήθηκε.');
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Διαγραφή κλήσης', 'Σίγουρα;', [
      { text: 'Ακύρωση', style: 'cancel' },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiDelete(`/api/communications?id=${call!.id}`);
            onChanged();
            onClose();
          } catch {
            Alert.alert('Σφάλμα', 'Η διαγραφή απέτυχε.');
          }
        },
      },
    ]);
  }

  return (
    <SheetModal
      visible={!!call}
      title={name ?? call.phone ?? 'Άγνωστος αριθμός'}
      onClose={onClose}>
      {view === 'actions' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {call.direction === 'inbound' ? 'Εισερχόμενη' : 'Εξερχόμενη'}
            {call.direction === 'inbound' && call.status !== 'completed' ? ' · αναπάντητη' : ''}
            {' · '}
            {formatWhen(call.createdAt)}
            {call.phone && name ? ` · ${call.phone}` : ''}
          </ThemedText>

          {loadingBrief && !brief ? (
            <View style={styles.briefLoading}>
              <ActivityIndicator color={Brand.primary} />
              <ThemedText type="small" themeColor="textSecondary">
                Ετοιμάζεται η περίληψη…
              </ThemedText>
            </View>
          ) : brief ? (
            <View style={styles.briefBox}>
              <View style={styles.briefTitleRow}>
                <ThemedText type="smallBold" style={styles.briefTitle}>
                  Περίληψη κλήσης
                </ThemedText>
                {polling && !briefReady ? <ActivityIndicator size="small" color={Brand.primary} /> : null}
              </View>
              <ThemedText type="small" style={styles.briefText}>
                {brief}
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Δεν υπάρχει περίληψη για αυτή την κλήση.
            </ThemedText>
          )}

          {actions.length > 0 ? (
            <View style={styles.chipRow}>
              {actions.map((a) => (
                <Pressable
                  key={a.actionType}
                  onPress={() => void runAction(a)}
                  disabled={busy}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                  <Ionicons name="sparkles" size={13} color={Brand.primary} />
                  <ThemedText type="small" style={styles.chipText}>
                    {a.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}

          {call.phone ? (
            <PrimaryButton
              label="Κλήση"
              onPress={() => {
                onClose();
                onDial(call.phone!);
              }}
            />
          ) : null}

          {call.customerId ? (
            <PrimaryButton
              label="Προβολή επαφής"
              tone="outline"
              onPress={() => {
                onClose();
                onOpenCustomer(call.customerId!);
              }}
            />
          ) : match ? (
            <PrimaryButton
              label={`Σύνδεση με: ${match.name ?? 'υπάρχουσα επαφή'}`}
              tone="outline"
              busy={busy}
              onPress={() => void linkTo(match.id)}
            />
          ) : call.phone ? (
            <PrimaryButton label="Προσθήκη επαφής" tone="outline" onPress={() => setView('add_contact')} />
          ) : null}

          <PrimaryButton label="Δημιουργία εργασίας" tone="outline" onPress={() => setView('create_task')} />
          <PrimaryButton label="Διαγραφή κλήσης" tone="danger" onPress={confirmDelete} />
        </>
      ) : view === 'add_contact' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Νέα επαφή για το {call.phone}
          </ThemedText>
          <Input label="Όνομα" value={cName} onChangeText={setCName} />
          <Input label="Εταιρεία (προαιρετικό)" value={cCompany} onChangeText={setCCompany} />
          <Input label="Email (προαιρετικό)" value={cEmail} onChangeText={setCEmail} keyboardType="email-address" />
          <PrimaryButton label="Αποθήκευση επαφής" onPress={() => void addContact()} busy={busy} />
          <PrimaryButton label="Πίσω" tone="outline" onPress={() => setView('actions')} />
        </>
      ) : (
        <>
          {name ? (
            <ThemedText type="small" themeColor="textSecondary">
              Θα συνδεθεί με: {name}
            </ThemedText>
          ) : null}
          <Input label="Τίτλος" value={tTitle} onChangeText={setTTitle} />
          <ThemedText type="small" themeColor="textSecondary">
            Τύπος
          </ThemedText>
          <ChipSelect options={TASK_TYPES} value={tType} onChange={setTType} />
          <Input label="Σημείωση (προαιρετικό)" value={tNote} onChangeText={setTNote} multiline />
          <PrimaryButton label="Αποθήκευση εργασίας" onPress={() => void createTask()} busy={busy} disabled={!tTitle.trim()} />
          <PrimaryButton label="Πίσω" tone="outline" onPress={() => setView('actions')} />
        </>
      )}
    </SheetModal>
  );
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    briefBox: { backgroundColor: c.surface, borderRadius: 14, padding: Spacing.three, gap: 6 },
    briefTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
    briefTitle: { color: c.text },
    briefText: { color: c.text },
    briefLoading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.two,
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: Spacing.three,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: Spacing.three,
      height: 34,
      borderRadius: 999,
      backgroundColor: Brand.primarySoft,
    },
    chipText: { color: Brand.primary, fontWeight: '700' },
    pressed: { opacity: 0.7 },
  });
