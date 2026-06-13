// Per-call action sheet — mirrors the web calls-page bottom sheet:
// full AI brief + actions (call, view/link/add contact, create task, delete).

import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipSelect, Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatWhen, todayYMD } from '@/lib/format';
import type { Communication, Customer } from '@/lib/types';

const TASK_TYPES: Array<{ key: string; label: string }> = [
  { key: 'call_back', label: 'Κλήση πίσω' },
  { key: 'send_offer', label: 'Αποστολή προσφοράς' },
  { key: 'book_appointment', label: 'Ραντεβού' },
  { key: 'other', label: 'Άλλο' },
];

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
  onClose,
  onChanged,
  onOpenCustomer,
  onDial,
}: {
  call: Communication | null;
  onClose: () => void;
  /** The list changed (link/delete) — reload. */
  onChanged: () => void;
  onOpenCustomer: (customerId: string) => void;
  onDial: (phone: string) => void;
}) {
  const [view, setView] = useState<'actions' | 'add_contact' | 'create_task'>('actions');
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<Customer | null>(null);

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

  if (!call) return null;

  const brief = fullBrief(call.summary);
  const name = call.customer?.name ?? null;

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
        // Post-call intake prompt: for an inbound caller we now have, offer to
        // immediately ask them for job details (web parity — the inbound flow
        // nudges toward an intake link).
        if (call!.direction === 'inbound') {
          Alert.alert('Επαφή δημιουργήθηκε', 'Να σταλεί αίτημα στοιχείων στον πελάτη (Viber → SMS);', [
            { text: 'Όχι', style: 'cancel', onPress: onClose },
            {
              text: 'Αποστολή αιτήματος',
              onPress: async () => {
                try {
                  const r = await apiPost<{ sent?: boolean; error?: string }>(`/api/customers/${newId}/intake-link`, { mode: 'send' });
                  Alert.alert(r?.sent ? '✓' : 'Αποστολή', r?.sent ? 'Στάλθηκε αίτημα στοιχείων.' : 'Δεν στάλθηκε (λείπει κινητό;).');
                } catch {
                  Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε.');
                } finally {
                  onClose();
                }
              },
            },
          ]);
        } else {
          onClose();
        }
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

          {brief ? (
            <View style={styles.briefBox}>
              <ThemedText type="smallBold" style={styles.briefTitle}>
                Περίληψη κλήσης
              </ThemedText>
              <ThemedText type="small" style={styles.briefText}>
                {brief}
              </ThemedText>
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Δεν υπάρχει περίληψη για αυτή την κλήση.
            </ThemedText>
          )}

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

const styles = StyleSheet.create({
  briefBox: { backgroundColor: '#F7F9FB', borderRadius: 14, padding: Spacing.three, gap: 6 },
  briefTitle: { color: '#0A1120' },
  briefText: { color: '#33404F' },
});
