// Customer workspace — messenger-style timeline + quick actions + composer.
// Mirrors the web chat page: GET /api/customers/[id]/timeline renders the feed;
// the composer creates appointments/offers/intake-links via the same APIs.

import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { dmyToYmd, formatEuro, formatWhen } from '@/lib/format';
import type { Customer, LinkDraft, TimelineItem } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  new: 'Νέος',
  in_progress: 'Σε εξέλιξη',
  won: 'Κερδισμένος',
  lost: 'Χαμένος',
};

export default function CustomerWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [infoOpen, setInfoOpen] = useState(false);
  const [apptOpen, setApptOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      // The timeline's customer payload is minimal ({id,name}) — fetch the full
      // customer record in parallel for the action buttons + info editor.
      const [detail, feed] = await Promise.all([
        apiGet<{ ok?: boolean; customer?: Customer }>(`/api/customers/${id}`),
        apiGet<{ ok?: boolean; items?: TimelineItem[] }>(`/api/customers/${id}/timeline`),
      ]);
      if (detail?.customer) {
        setCustomer(detail.customer);
        setItems(Array.isArray(feed?.items) ? [...feed.items].reverse() : []); // newest first (inverted list)
      } else {
        setError('Δεν βρέθηκε ο πελάτης.');
      }
    } catch {
      setError('Σφάλμα σύνδεσης.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const callPhone = customer?.mobilePhone || customer?.phone || customer?.landlinePhone || '';

  if (loading) {
    return (
      <ThemedView style={styles.fill}>
        <Stack.Screen options={{ title: 'Πελάτης' }} />
        <View style={styles.center}>
          <ActivityIndicator color={Brand.primary} />
        </View>
      </ThemedView>
    );
  }
  if (error || !customer) {
    return (
      <ThemedView style={styles.fill}>
        <Stack.Screen options={{ title: 'Πελάτης' }} />
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">{error ?? 'Σφάλμα.'}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: customer.name ?? 'Πελάτης' }} />

      {/* Quick-action header row */}
      <View style={styles.actionsRow}>
        <HeaderAction
          icon="call"
          label="Κλήση"
          disabled={!callPhone}
          onPress={() => router.push({ pathname: '/calls', params: { num: callPhone } })}
        />
        <HeaderAction
          icon="chatbubble-ellipses"
          label="SMS"
          disabled={!callPhone}
          onPress={() => callPhone && Linking.openURL(`sms:${callPhone}`)}
        />
        <HeaderAction icon="information-circle" label="Πληροφορίες" onPress={() => setInfoOpen(true)} />
      </View>

      {/* Timeline (chat) */}
      {items.length === 0 ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">Καμία δραστηριότητα ακόμα.</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Ξεκίνα με μια κλήση, ραντεβού ή προσφορά από κάτω.
          </ThemedText>
        </View>
      ) : (
        <FlatList
          inverted
          data={items}
          keyExtractor={(it) => `${it.type}-${it.id}`}
          contentContainerStyle={styles.feed}
          renderItem={({ item }) => <Bubble item={item} />}
        />
      )}

      {/* Composer */}
      <SafeAreaView edges={['bottom']} style={styles.composerSafe}>
        <View style={styles.composer}>
          <ComposerButton icon="calendar" label="Ραντεβού" onPress={() => setApptOpen(true)} />
          <ComposerButton icon="document-text" label="Προσφορά" onPress={() => setOfferOpen(true)} />
          <ComposerButton icon="images" label="Αίτημα" onPress={() => setIntakeOpen(true)} />
        </View>
      </SafeAreaView>

      <InfoModal
        visible={infoOpen}
        customer={customer}
        onClose={() => setInfoOpen(false)}
        onSaved={() => {
          setInfoOpen(false);
          void load();
        }}
      />
      <AppointmentModal
        visible={apptOpen}
        customerId={customer.id}
        onClose={() => setApptOpen(false)}
        onDone={() => {
          setApptOpen(false);
          void load();
        }}
      />
      <OfferModal
        visible={offerOpen}
        customerId={customer.id}
        onClose={() => setOfferOpen(false)}
        onDone={() => {
          setOfferOpen(false);
          void load();
        }}
      />
      <IntakeModal
        visible={intakeOpen}
        customerId={customer.id}
        onClose={() => setIntakeOpen(false)}
        onDone={() => {
          setIntakeOpen(false);
          void load();
        }}
      />
    </ThemedView>
  );
}

// ---------- timeline bubbles ----------

const TYPE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap; label?: string }> = {
  call: { icon: 'call' },
  sms: { icon: 'chatbubble' },
  viber: { icon: 'chatbubbles' },
  email: { icon: 'mail' },
  offer: { icon: 'document-text' },
  offer_response: { icon: 'document-text' },
  appointment: { icon: 'calendar' },
  appointment_response: { icon: 'calendar' },
  intake_request: { icon: 'link' },
  intake_submitted: { icon: 'checkmark-circle' },
  upload: { icon: 'images' },
};

function responseTone(item: TimelineItem): { text: string; color: string } | null {
  if (item.type === 'offer_response') {
    return item.status === 'accepted'
      ? { text: 'Αποδέχτηκε την προσφορά ✓', color: '#1B8A4C' }
      : { text: 'Απέρριψε την προσφορά', color: '#D14343' };
  }
  if (item.type === 'appointment_response') {
    if (item.status === 'accepted') return { text: 'Επιβεβαίωσε το ραντεβού ✓', color: '#1B8A4C' };
    if (item.status === 'declined') return { text: 'Απέρριψε το ραντεβού', color: '#D14343' };
    return { text: 'Ζήτησε αλλαγή ώρας', color: '#B7791F' };
  }
  return null;
}

function Bubble({ item }: { item: TimelineItem }) {
  const [expanded, setExpanded] = useState(false);
  const us = item.side === 'us';
  const meta = TYPE_META[item.type] ?? { icon: 'ellipse' as const };
  const tone = responseTone(item);

  const body = item.body ?? '';
  const isLong = body.length > 280;
  const shown = expanded || !isLong ? body : body.slice(0, 280) + '…';

  return (
    <View style={[styles.bubbleRow, us ? styles.rowUs : styles.rowCust]}>
      <View style={[styles.bubble, us ? styles.bubbleUs : styles.bubbleCust]}>
        <View style={styles.bubbleHead}>
          <Ionicons name={meta.icon} size={14} color={us ? Brand.primary : '#5B6472'} />
          <ThemedText type="smallBold" style={tone ? { color: tone.color } : undefined}>
            {tone ? tone.text : item.title}
          </ThemedText>
        </View>
        {item.type === 'appointment' && item.payload?.dueDate ? (
          <ThemedText type="small" themeColor="textSecondary">
            {item.payload.dueDate.split('-').reverse().join('-')}
            {item.payload.dueTime ? ` · ${item.payload.dueTime}` : ''}
          </ThemedText>
        ) : null}
        {shown ? <ThemedText type="small">{shown}</ThemedText> : null}
        {isLong ? (
          <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
            <ThemedText type="small" style={styles.moreLink}>
              {expanded ? 'Λιγότερα' : 'Περισσότερα'}
            </ThemedText>
          </Pressable>
        ) : null}
        <ThemedText type="small" themeColor="textSecondary" style={styles.when}>
          {formatWhen(item.occurredAt)}
        </ThemedText>
      </View>
    </View>
  );
}

// ---------- header / composer buttons ----------

function HeaderAction({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.headerAction, disabled && styles.disabled, pressed && styles.pressed]}>
      <Ionicons name={icon} size={18} color={Brand.primary} />
      <ThemedText type="small" style={styles.headerActionText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ComposerButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.composerBtn, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={Brand.onPrimary} />
      <ThemedText style={styles.composerBtnText}>{label}</ThemedText>
    </Pressable>
  );
}

// ---------- shared modal scaffolding ----------

function SheetModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalKav}>
          <ThemedView style={styles.modalSheet}>
            <View style={styles.modalHead}>
              <ThemedText type="smallBold" style={styles.modalTitle}>
                {title}
              </ThemedText>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color="#5B6472" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </ThemedView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
}) {
  return (
    <View style={styles.inputBlock}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9AA4B2"
        keyboardType={keyboardType}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={({ pressed }) => [styles.primaryBtn, (busy || disabled) && styles.disabled, pressed && styles.pressed]}>
      {busy ? (
        <ActivityIndicator color={Brand.onPrimary} />
      ) : (
        <ThemedText style={styles.primaryBtnText}>{label}</ThemedText>
      )}
    </Pressable>
  );
}

/** Draft → review → send flow shared by intake/appointment/offer links. */
function SendPreview({
  draft,
  busy,
  onSend,
}: {
  draft: LinkDraft;
  busy: boolean;
  onSend: () => void;
}) {
  return (
    <View style={styles.previewBlock}>
      <ThemedText type="smallBold">Μήνυμα προς {draft.recipient ?? 'πελάτη'}:</ThemedText>
      <ThemedView type="backgroundElement" style={styles.previewCard}>
        <ThemedText type="small">{draft.message ?? ''}</ThemedText>
      </ThemedView>
      {draft.warning ? (
        <ThemedText type="small" style={styles.warnText}>
          {draft.warning}
        </ThemedText>
      ) : null}
      <PrimaryButton label="Αποστολή (Viber → SMS)" onPress={onSend} busy={busy} />
    </View>
  );
}

// ---------- info modal ----------

function InfoModal({
  visible,
  customer,
  onClose,
  onSaved,
}: {
  visible: boolean;
  customer: Customer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string>(customer.status ?? 'new');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setForm({
      name: customer.name ?? '',
      companyName: customer.companyName ?? '',
      mobilePhone: customer.mobilePhone ?? '',
      landlinePhone: customer.landlinePhone ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      needsSummary: customer.needsSummary ?? '',
      notes: customer.notes ?? '',
    });
    setStatus(customer.status ?? 'new');
  }, [visible, customer]);

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      const res = await apiPatch<{ ok?: boolean; error?: string }>(`/api/customers/${customer.id}`, {
        name: form.name || null,
        companyName: form.companyName || null,
        mobilePhone: form.mobilePhone || null,
        landlinePhone: form.landlinePhone || null,
        email: form.email || null,
        address: form.address || null,
        needsSummary: form.needsSummary || null,
        notes: form.notes || null,
        status,
      });
      if (res?.ok) onSaved();
      else Alert.alert('Σφάλμα', res?.error ?? 'Η αποθήκευση απέτυχε.');
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} title="Στοιχεία πελάτη" onClose={onClose}>
      <Input label="Όνομα" value={form.name ?? ''} onChangeText={set('name')} />
      <Input label="Εταιρεία" value={form.companyName ?? ''} onChangeText={set('companyName')} />
      <Input label="Κινητό" value={form.mobilePhone ?? ''} onChangeText={set('mobilePhone')} keyboardType="phone-pad" />
      <Input label="Σταθερό" value={form.landlinePhone ?? ''} onChangeText={set('landlinePhone')} keyboardType="phone-pad" />
      <Input label="Email" value={form.email ?? ''} onChangeText={set('email')} keyboardType="email-address" />
      <Input label="Διεύθυνση" value={form.address ?? ''} onChangeText={set('address')} />

      <ThemedText type="small" themeColor="textSecondary">
        Κατάσταση
      </ThemedText>
      <View style={styles.statusRow}>
        {(['new', 'in_progress', 'won', 'lost'] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => setStatus(s)}
            style={[styles.statusChip, status === s && styles.statusChipActive]}>
            <ThemedText type="small" style={status === s ? styles.statusChipActiveText : undefined}>
              {STATUS_LABELS[s]}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Input label="Ανάγκες" value={form.needsSummary ?? ''} onChangeText={set('needsSummary')} multiline />
      <Input label="Σημειώσεις" value={form.notes ?? ''} onChangeText={set('notes')} multiline />

      {form.address ? (
        <Pressable
          onPress={() =>
            Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.address)}`)
          }
          style={({ pressed }) => [styles.mapsLink, pressed && styles.pressed]}>
          <Ionicons name="map" size={16} color={Brand.primary} />
          <ThemedText type="small" style={{ color: Brand.primary, fontWeight: '700' }}>
            Άνοιγμα στο Google Maps
          </ThemedText>
        </Pressable>
      ) : null}

      <PrimaryButton label="Αποθήκευση" onPress={() => void save()} busy={busy} />
    </SheetModal>
  );
}

// ---------- appointment modal ----------

function AppointmentModal({
  visible,
  customerId,
  onClose,
  onDone,
}: {
  visible: boolean;
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('Ραντεβού');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle('Ραντεβού');
      setDate('');
      setTime('');
      setNote('');
      setDraft(null);
      setTaskId(null);
    }
  }, [visible]);

  async function create() {
    const ymd = dmyToYmd(date);
    if (!ymd) {
      Alert.alert('Ημερομηνία', 'Γράψε ημερομηνία ως ΗΗ-ΜΜ-ΕΕΕΕ (π.χ. 15-06-2026).');
      return;
    }
    if (time && !/^\d{1,2}:\d{2}$/.test(time.trim())) {
      Alert.alert('Ώρα', 'Γράψε ώρα ως ΩΩ:ΛΛ (π.χ. 10:30).');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; task?: { id: string }; error?: string }>('/api/tasks', {
        customerId,
        title: title.trim() || 'Ραντεβού',
        type: 'book_appointment',
        status: 'open',
        dueDate: ymd,
        dueTime: time.trim() || null,
        note: note.trim() || null,
      });
      if (!res?.ok || !res.task?.id) {
        Alert.alert('Σφάλμα', res?.error ?? 'Δεν δημιουργήθηκε το ραντεβού.');
        return;
      }
      setTaskId(res.task.id);
      // Build the confirmation-link draft for the customer.
      const d = await apiPost<LinkDraft>(`/api/customers/${customerId}/appointment-link`, {
        taskId: res.task.id,
        mode: 'draft',
      });
      if (d?.message) setDraft(d);
      else onDone(); // appointment saved; no sendable link (e.g. no phone) — finish.
    } catch {
      Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε το ραντεβού.');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!taskId) return;
    setBusy(true);
    try {
      const r = await apiPost<LinkDraft>(`/api/customers/${customerId}/appointment-link`, {
        taskId,
        mode: 'send',
        channel: 'viber',
      });
      if (r?.sent === false && r.fallbackReason) Alert.alert('Αποστολή', `Στάλθηκε με εναλλακτικό κανάλι: ${r.fallbackReason}`);
      onDone();
    } catch {
      Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε — το ραντεβού όμως αποθηκεύτηκε.');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} title="Νέο ραντεβού" onClose={onClose}>
      {!draft ? (
        <>
          <Input label="Τίτλος" value={title} onChangeText={setTitle} />
          <Input label="Ημερομηνία (ΗΗ-ΜΜ-ΕΕΕΕ)" value={date} onChangeText={setDate} placeholder="15-06-2026" />
          <Input label="Ώρα (προαιρετικό)" value={time} onChangeText={setTime} placeholder="10:30" />
          <Input label="Σημείωση (προαιρετικό)" value={note} onChangeText={setNote} multiline />
          <PrimaryButton label="Δημιουργία" onPress={() => void create()} busy={busy} disabled={!date.trim()} />
        </>
      ) : (
        <SendPreview draft={draft} busy={busy} onSend={() => void send()} />
      )}
    </SheetModal>
  );
}

// ---------- offer modal ----------

interface DraftItem {
  description: string;
  quantity: string;
  unitPrice: string;
}

function OfferModal({
  visible,
  customerId,
  onClose,
  onDone,
}: {
  visible: boolean;
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<DraftItem[]>([{ description: '', quantity: '1', unitPrice: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setRows([{ description: '', quantity: '1', unitPrice: '' }]);
      setNotes('');
      setDraft(null);
      setOfferId(null);
    }
  }, [visible]);

  const setRow = (i: number, k: keyof DraftItem) => (v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const total = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const q = parseFloat(r.quantity.replace(',', '.')) || 0;
        const p = parseFloat(r.unitPrice.replace(',', '.')) || 0;
        return sum + q * p;
      }, 0),
    [rows],
  );

  async function create() {
    const items = rows
      .map((r, i) => ({
        description: r.description.trim(),
        quantity: parseFloat(r.quantity.replace(',', '.')) || 0,
        unitPrice: parseFloat(r.unitPrice.replace(',', '.')) || 0,
        sortOrder: i,
      }))
      .filter((it) => it.description && it.quantity > 0);
    if (items.length === 0) {
      Alert.alert('Προσφορά', 'Συμπλήρωσε τουλάχιστον μία γραμμή (περιγραφή + ποσότητα).');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; offer?: { id: string }; error?: string }>('/api/offers', {
        customerId,
        status: 'ready_to_send',
        items,
        notes: notes.trim() || null,
      });
      if (!res?.ok || !res.offer?.id) {
        Alert.alert('Σφάλμα', res?.error ?? 'Δεν δημιουργήθηκε η προσφορά.');
        return;
      }
      setOfferId(res.offer.id);
      const d = await apiPost<LinkDraft>(`/api/offers/${res.offer.id}/notify`, { mode: 'draft' });
      if (d?.message) setDraft(d);
      else onDone();
    } catch {
      Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε η προσφορά.');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!offerId) return;
    setBusy(true);
    try {
      const r = await apiPost<LinkDraft>(`/api/offers/${offerId}/notify`, { mode: 'send' });
      if (r?.sent === false && r.fallbackReason) Alert.alert('Αποστολή', `Εναλλακτικό κανάλι: ${r.fallbackReason}`);
      onDone();
    } catch {
      Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε — η προσφορά όμως αποθηκεύτηκε.');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} title="Νέα προσφορά" onClose={onClose}>
      {!draft ? (
        <>
          {rows.map((r, i) => (
            <View key={i} style={styles.offerRow}>
              <View style={styles.offerDesc}>
                <Input label={`Περιγραφή ${i + 1}`} value={r.description} onChangeText={setRow(i, 'description')} />
              </View>
              <View style={styles.offerQty}>
                <Input label="Ποσ." value={r.quantity} onChangeText={setRow(i, 'quantity')} keyboardType="decimal-pad" />
              </View>
              <View style={styles.offerPrice}>
                <Input label="Τιμή €" value={r.unitPrice} onChangeText={setRow(i, 'unitPrice')} keyboardType="decimal-pad" />
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => setRows((rs) => [...rs, { description: '', quantity: '1', unitPrice: '' }])}
            style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}>
            <Ionicons name="add" size={18} color={Brand.primary} />
            <ThemedText type="small" style={{ color: Brand.primary, fontWeight: '700' }}>
              Προσθήκη γραμμής
            </ThemedText>
          </Pressable>
          <Input label="Σημειώσεις (προαιρετικό)" value={notes} onChangeText={setNotes} multiline />
          <ThemedText type="smallBold" style={styles.totalLine}>
            Σύνολο (χωρίς ΦΠΑ): {formatEuro(total)}
          </ThemedText>
          <PrimaryButton label="Δημιουργία προσφοράς" onPress={() => void create()} busy={busy} />
        </>
      ) : (
        <SendPreview draft={draft} busy={busy} onSend={() => void send()} />
      )}
    </SheetModal>
  );
}

// ---------- intake / photos request modal ----------

function IntakeModal({
  visible,
  customerId,
  onClose,
  onDone,
}: {
  visible: boolean;
  customerId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LinkDraft | null>(null);

  useEffect(() => {
    if (!visible) {
      setDraft(null);
      return;
    }
    // Build the draft as soon as the sheet opens.
    (async () => {
      setBusy(true);
      try {
        const d = await apiPost<LinkDraft>(`/api/customers/${customerId}/intake-link`, { mode: 'draft' });
        if (d?.message) setDraft(d);
        else Alert.alert('Σφάλμα', d?.error ?? 'Δεν δημιουργήθηκε ο σύνδεσμος.');
      } catch {
        Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε ο σύνδεσμος.');
      } finally {
        setBusy(false);
      }
    })();
  }, [visible, customerId]);

  async function send() {
    setBusy(true);
    try {
      const r = await apiPost<LinkDraft>(`/api/customers/${customerId}/intake-link`, {
        mode: 'send',
        channel: 'viber',
      });
      if (r?.sent === false && r.fallbackReason) Alert.alert('Αποστολή', `Εναλλακτικό κανάλι: ${r.fallbackReason}`);
      onDone();
    } catch {
      Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} title="Αίτημα στοιχείων / φωτογραφιών" onClose={onClose}>
      {draft ? (
        <SendPreview draft={draft} busy={busy} onSend={() => void send()} />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={Brand.primary} />
        </View>
      )}
    </SheetModal>
  );
}

// ---------- styles ----------

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },

  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F5',
  },
  headerAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 12,
    backgroundColor: Brand.primarySoft,
  },
  headerActionText: { color: Brand.primary, fontWeight: '700' },

  feed: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, gap: Spacing.two },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  rowUs: { justifyContent: 'flex-end' },
  rowCust: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 16, padding: Spacing.three, gap: 4 },
  bubbleUs: { backgroundColor: Brand.primarySoft, borderBottomRightRadius: 4 },
  bubbleCust: { backgroundColor: '#F2F4F7', borderBottomLeftRadius: 4 },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  when: { fontSize: 11, alignSelf: 'flex-end' },
  moreLink: { color: Brand.primary, fontWeight: '700' },

  composerSafe: { borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  composer: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  composerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 46,
    borderRadius: 14,
    backgroundColor: Brand.primary,
  },
  composerBtnText: { color: Brand.onPrimary, fontWeight: '700', fontSize: 14 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(10,17,32,0.45)', justifyContent: 'flex-end' },
  modalKav: { width: '100%' },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%' },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  modalTitle: { fontSize: 17 },
  modalBody: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three },

  inputBlock: { gap: 4 },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D8DEE6',
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0A1120',
    backgroundColor: '#FFFFFF',
  },
  inputMultiline: { minHeight: 84, textAlignVertical: 'top' },

  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  statusChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D8DEE6',
  },
  statusChipActive: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  statusChipActiveText: { color: Brand.onPrimary, fontWeight: '700' },

  mapsLink: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.one },

  primaryBtn: {
    height: 50,
    borderRadius: 14,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  primaryBtnText: { color: Brand.onPrimary, fontSize: 15, fontWeight: '700' },

  previewBlock: { gap: Spacing.three },
  previewCard: { padding: Spacing.three, borderRadius: 14 },
  warnText: { color: '#B7791F' },

  offerRow: { flexDirection: 'row', gap: Spacing.two },
  offerDesc: { flex: 2 },
  offerQty: { width: 64 },
  offerPrice: { width: 86 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.one },
  totalLine: { textAlign: 'right' },

  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
