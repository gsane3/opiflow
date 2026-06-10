// Customer workspace — messenger timeline + composer + info panel (web parity).
// Timeline: GET /api/customers/[id]/timeline. Tappable bubbles: call → full-brief
// modal, offer → OfferPreviewSheet, upload → info panel (gallery). Composer:
// Ραντεβού, Προσφορά (with catalog autosuggest), Αίτημα στοιχείων / φωτογραφιών
// (two separate direct-send actions, like the web ChatComposerSheet).

import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfferPreviewSheet } from '@/components/offer-preview-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing } from '@/constants/theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { dmyToYmd, formatEuro, formatWhen } from '@/lib/format';
import type { CatalogItem, Customer, LinkDraft, TimelineItem } from '@/lib/types';

export default function CustomerWorkspaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [suggested, setSuggested] = useState<Array<{ id: string; actionType: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [apptOpen, setApptOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [briefItem, setBriefItem] = useState<TimelineItem | null>(null);
  const [previewOfferId, setPreviewOfferId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const [detail, feed, sugg] = await Promise.all([
        apiGet<{ ok?: boolean; customer?: Customer }>(`/api/customers/${id}`),
        apiGet<{ ok?: boolean; items?: TimelineItem[] }>(`/api/customers/${id}/timeline`),
        apiGet<{ ok?: boolean; actions?: Array<{ id: string; actionType: string; label: string }> }>(
          `/api/customers/${id}/suggested-actions`,
        ),
      ]);
      if (detail?.customer) {
        setCustomer(detail.customer);
        setItems(Array.isArray(feed?.items) ? [...feed.items].reverse() : []); // newest first (inverted list)
        setSuggested(Array.isArray(sugg?.actions) ? sugg.actions : []);
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

  /** Direct-send (web parity): intake-link or upload-link with mode:'send'. */
  function sendRequest(kind: 'intake' | 'upload') {
    const label = kind === 'intake' ? 'στοιχείων' : 'φωτογραφιών';
    Alert.alert(`Αίτημα ${label}`, `Θα σταλεί σύνδεσμος στον πελάτη (Viber → SMS). Συνέχεια;`, [
      { text: 'Ακύρωση', style: 'cancel' },
      {
        text: 'Αποστολή',
        onPress: async () => {
          setSending(true);
          try {
            const r = await apiPost<LinkDraft>(
              `/api/customers/${id}/${kind === 'intake' ? 'intake-link' : 'upload-link'}`,
              { mode: 'send' },
            );
            if (r?.sent) Alert.alert('✓', `Στάλθηκε αίτημα ${label}.`);
            else Alert.alert('Αποστολή', r?.fallbackReason ?? r?.error ?? 'Δεν στάλθηκε (λείπει κινητό;).');
            void load();
          } catch {
            Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε.');
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  }

  function chooseRequest() {
    Alert.alert('Αίτημα προς πελάτη', 'Τι θες να ζητήσεις;', [
      { text: 'Αίτημα στοιχείων', onPress: () => sendRequest('intake') },
      { text: 'Αίτημα φωτογραφιών', onPress: () => sendRequest('upload') },
      { text: 'Ακύρωση', style: 'cancel' },
    ]);
  }

  async function dismissSuggestion(sid: string) {
    setSuggested((s) => s.filter((a) => a.id !== sid));
    try {
      await apiPatch(`/api/customers/${id}/suggested-actions`, { id: sid, status: 'done' });
    } catch {
      // non-fatal
    }
  }

  function onSuggestionTap(a: { id: string; actionType: string }) {
    if (a.actionType === 'send_offer') setOfferOpen(true);
    else if (a.actionType === 'book_appointment') setApptOpen(true);
    void dismissSuggestion(a.id);
  }

  function openInfo() {
    // Typed-routes regenerate on the next dev/prebuild — cast keeps tsc green.
    router.push({ pathname: '/customers/[id]/info', params: { id: String(id) } } as never);
  }

  function onBubbleTap(item: TimelineItem) {
    if (item.type === 'call' && item.body) setBriefItem(item);
    else if ((item.type === 'offer' || item.type === 'offer_response') && item.refTable === 'offers' && item.refId)
      setPreviewOfferId(item.refId);
    else if (item.type === 'upload' || item.type === 'intake_submitted') openInfo();
  }

  if (loading) {
    return (
      <ThemedView style={styles.fill}>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView edges={['top']} />
        <View style={styles.center}>
          <ActivityIndicator color={Brand.primary} />
        </View>
      </ThemedView>
    );
  }
  if (error || !customer) {
    return (
      <ThemedView style={styles.fill}>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView edges={['top']} />
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">{error ?? 'Σφάλμα.'}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Messenger-style header: back · avatar+name (tap → profile) · call */}
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={28} color={Brand.primary} />
          </Pressable>
          <Pressable onPress={openInfo} style={({ pressed }) => [styles.headerIdentity, pressed && styles.pressed]}>
            <View style={styles.headerAvatar}>
              <ThemedText style={styles.headerAvatarText}>
                {(customer.name ?? 'Π').trim().slice(0, 1).toUpperCase()}
              </ThemedText>
            </View>
            <View style={styles.headerNameWrap}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.headerName}>
                {customer.name ?? 'Πελάτης'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.headerSub}>
                {callPhone || 'Χωρίς τηλέφωνο'} ›
              </ThemedText>
            </View>
          </Pressable>
          <Pressable
            onPress={() => callPhone && router.push({ pathname: '/calls', params: { num: callPhone } })}
            disabled={!callPhone}
            hitSlop={8}
            style={({ pressed }) => [styles.headerCall, !callPhone && styles.disabled, pressed && styles.pressed]}>
            <Ionicons name="call" size={22} color={Brand.primary} />
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Timeline (chat) */}
      {items.length === 0 ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">Καμία δραστηριότητα ακόμα.</ThemedText>
        </View>
      ) : (
        <FlatList
          inverted
          data={items}
          keyExtractor={(it) => `${it.type}-${it.id}`}
          contentContainerStyle={styles.feed}
          renderItem={({ item }) => <Bubble item={item} onPress={() => onBubbleTap(item)} />}
        />
      )}

      {/* Suggested actions */}
      {suggested.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestRow} contentContainerStyle={styles.suggestContent}>
          {suggested.map((a) => (
            <Pressable key={a.id} onPress={() => onSuggestionTap(a)} style={({ pressed }) => [styles.suggestChip, pressed && styles.pressed]}>
              <Ionicons name="sparkles" size={13} color={Brand.primary} />
              <ThemedText type="small" style={styles.suggestText}>
                {a.label}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Composer */}
      <SafeAreaView edges={['bottom']} style={styles.composerSafe}>
        <View style={styles.composer}>
          <ComposerButton icon="calendar" label="Ραντεβού" onPress={() => setApptOpen(true)} />
          <ComposerButton icon="document-text" label="Προσφορά" onPress={() => setOfferOpen(true)} />
          <ComposerButton icon="link" label="Αίτημα" onPress={chooseRequest} busy={sending} />
        </View>
      </SafeAreaView>

      {/* Sheets / modals */}
      <OfferPreviewSheet offerId={previewOfferId} onClose={() => setPreviewOfferId(null)} onChanged={() => void load()} />
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

      {/* Full-brief modal */}
      <SheetModal visible={!!briefItem} title="Περίληψη κλήσης" onClose={() => setBriefItem(null)}>
        {briefItem ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              {briefItem.title} · {formatWhen(briefItem.occurredAt)}
            </ThemedText>
            <ThemedText type="small" style={styles.dark}>
              {briefItem.body}
            </ThemedText>
          </>
        ) : null}
      </SheetModal>
    </ThemedView>
  );
}

// ---------- timeline bubbles ----------

const TYPE_META: Record<string, { icon: keyof typeof Ionicons.glyphMap }> = {
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

const TAPPABLE = new Set(['call', 'offer', 'offer_response', 'upload', 'intake_submitted']);

function Bubble({ item, onPress }: { item: TimelineItem; onPress: () => void }) {
  // Messenger look: our side = brand blue with white text, customer = light gray.
  const us = item.side === 'us';
  const meta = TYPE_META[item.type] ?? { icon: 'ellipse' as const };
  const tone = responseTone(item);
  const tappable = TAPPABLE.has(item.type) && (item.type !== 'call' || !!item.body);

  const body = item.body ?? '';
  const shown = body.length > 220 ? body.slice(0, 220) + '…' : body;
  const fg = us ? styles.onBlue : styles.dark;
  const fgMuted = us ? styles.onBlueMuted : undefined;

  return (
    <View style={[styles.bubbleRow, us ? styles.rowUs : styles.rowCust]}>
      <Pressable
        onPress={tappable ? onPress : undefined}
        disabled={!tappable}
        style={({ pressed }) => [styles.bubble, us ? styles.bubbleUs : styles.bubbleCust, pressed && styles.pressed]}>
        <View style={styles.bubbleHead}>
          <Ionicons name={meta.icon} size={14} color={us ? '#FFFFFF' : '#5B6472'} />
          <ThemedText type="smallBold" style={[fg, tone && !us ? { color: tone.color } : null]}>
            {tone ? tone.text : item.title}
          </ThemedText>
        </View>
        {item.type === 'appointment' && item.payload?.dueDate ? (
          <ThemedText type="small" style={fgMuted} themeColor={us ? undefined : 'textSecondary'}>
            {item.payload.dueDate.split('-').reverse().join('-')}
            {item.payload.dueTime ? ` · ${item.payload.dueTime}` : ''}
          </ThemedText>
        ) : null}
        {shown ? (
          <ThemedText type="small" style={fg}>
            {shown}
          </ThemedText>
        ) : null}
        {tappable ? (
          <ThemedText type="small" style={us ? styles.tapHintOnBlue : styles.tapHint}>
            {item.type === 'call' ? 'Προβολή περίληψης ›' : item.type.startsWith('offer') ? 'Προβολή προσφοράς ›' : 'Προβολή ›'}
          </ThemedText>
        ) : null}
        <ThemedText type="small" style={[styles.when, fgMuted]} themeColor={us ? undefined : 'textSecondary'}>
          {formatWhen(item.occurredAt)}
        </ThemedText>
      </Pressable>
    </View>
  );
}

// ---------- composer buttons ----------

function ComposerButton({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.composerBtn, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={Brand.onPrimary} size="small" /> : <Ionicons name={icon} size={20} color={Brand.onPrimary} />}
      <ThemedText style={styles.composerBtnText}>{label}</ThemedText>
    </Pressable>
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
      const d = await apiPost<LinkDraft>(`/api/customers/${customerId}/appointment-link`, {
        taskId: res.task.id,
        mode: 'draft',
      });
      if (d?.message) setDraft(d);
      else onDone();
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
      if (r?.sent === false && r.fallbackReason) Alert.alert('Αποστολή', `Εναλλακτικό κανάλι: ${r.fallbackReason}`);
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
        <>
          <ThemedText type="smallBold" style={styles.dark}>
            Μήνυμα προς {draft.recipient ?? 'πελάτη'}:
          </ThemedText>
          <View style={styles.msgBox}>
            <ThemedText type="small" style={styles.dark}>
              {draft.message}
            </ThemedText>
          </View>
          <PrimaryButton label="Αποστολή (Viber → SMS)" onPress={() => void send()} busy={busy} />
        </>
      )}
    </SheetModal>
  );
}

// ---------- offer modal (with catalog autosuggest) ----------

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
  // catalog autosuggest for the active row
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);

  useEffect(() => {
    if (visible) {
      setRows([{ description: '', quantity: '1', unitPrice: '' }]);
      setNotes('');
      setDraft(null);
      setOfferId(null);
      setSuggestions([]);
      setActiveRow(null);
    }
  }, [visible]);

  const setRow = (i: number, k: keyof DraftItem) => (v: string) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
    if (k === 'description') {
      setActiveRow(i);
      const q = v.trim();
      if (q.length >= 2) {
        void apiGet<{ ok?: boolean; items?: CatalogItem[] }>(`/api/catalog?q=${encodeURIComponent(q)}`).then((res) =>
          setSuggestions((res?.items ?? []).slice(0, 5)),
        );
      } else {
        setSuggestions([]);
      }
    }
  };

  function pickSuggestion(i: number, item: CatalogItem) {
    setRows((rs) =>
      rs.map((r, idx) => (idx === i ? { ...r, description: item.name, unitPrice: String(item.unitPrice) } : r)),
    );
    setSuggestions([]);
  }

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
            <View key={i}>
              <View style={styles.offerRow}>
                <View style={styles.offerDesc}>
                  <Input label={`Περιγραφή ${i + 1}`} value={r.description} onChangeText={setRow(i, 'description')} onFocus={() => setActiveRow(i)} />
                </View>
                <View style={styles.offerQty}>
                  <Input label="Ποσ." value={r.quantity} onChangeText={setRow(i, 'quantity')} keyboardType="decimal-pad" />
                </View>
                <View style={styles.offerPrice}>
                  <Input label="Τιμή €" value={r.unitPrice} onChangeText={setRow(i, 'unitPrice')} keyboardType="decimal-pad" />
                </View>
              </View>
              {activeRow === i && suggestions.length > 0 ? (
                <View style={styles.suggestBox}>
                  {suggestions.map((s) => (
                    <Pressable key={s.id} onPress={() => pickSuggestion(i, s)} style={({ pressed }) => [styles.suggestItem, pressed && styles.pressed]}>
                      <ThemedText type="small" style={styles.dark} numberOfLines={1}>
                        {s.name}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {formatEuro(s.unitPrice)}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
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
          <ThemedText type="smallBold" style={[styles.totalLine, styles.dark]}>
            Σύνολο (χωρίς ΦΠΑ): {formatEuro(total)}
          </ThemedText>
          <PrimaryButton label="Δημιουργία προσφοράς" onPress={() => void create()} busy={busy} />
        </>
      ) : (
        <>
          <ThemedText type="smallBold" style={styles.dark}>
            Μήνυμα προς {draft.recipient ?? 'πελάτη'}:
          </ThemedText>
          <View style={styles.msgBox}>
            <ThemedText type="small" style={styles.dark}>
              {draft.message}
            </ThemedText>
          </View>
          <PrimaryButton label="Αποστολή (Viber → SMS)" onPress={() => void send()} busy={busy} />
        </>
      )}
    </SheetModal>
  );
}

// ---------- styles ----------

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  dark: { color: '#0A1120' },

  headerSafe: { borderBottomWidth: 1, borderBottomColor: '#EEF1F5', backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: 6,
  },
  headerBack: { padding: 4 },
  headerIdentity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  headerAvatarText: { color: Brand.primary, fontSize: 16, fontWeight: '700' },
  headerNameWrap: { flex: 1 },
  headerName: { fontSize: 16, color: '#0A1120' },
  headerSub: { fontSize: 12 },
  headerCall: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  onBlue: { color: '#FFFFFF' },
  onBlueMuted: { color: 'rgba(255,255,255,0.75)' },
  tapHintOnBlue: { color: '#FFFFFF', fontWeight: '700', textDecorationLine: 'underline' },

  feed: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, gap: Spacing.two },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  rowUs: { justifyContent: 'flex-end' },
  rowCust: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 16, padding: Spacing.three, gap: 4 },
  bubbleUs: { backgroundColor: Brand.primary, borderBottomRightRadius: 4 },
  bubbleCust: { backgroundColor: '#F2F4F7', borderBottomLeftRadius: 4 },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  when: { fontSize: 11, alignSelf: 'flex-end' },
  tapHint: { color: Brand.primary, fontWeight: '700' },

  suggestRow: { maxHeight: 44, borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  suggestContent: { paddingHorizontal: Spacing.four, paddingVertical: 6, gap: Spacing.two, alignItems: 'center' },
  suggestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.three,
    height: 32,
    borderRadius: 999,
    backgroundColor: Brand.primarySoft,
  },
  suggestText: { color: Brand.primary, fontWeight: '700' },

  composerSafe: { borderTopWidth: 1, borderTopColor: '#EEF1F5', backgroundColor: '#FFFFFF' },
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

  msgBox: { backgroundColor: '#F7F9FB', borderRadius: 14, padding: Spacing.three },

  offerRow: { flexDirection: 'row', gap: Spacing.two },
  offerDesc: { flex: 2 },
  offerQty: { width: 64 },
  offerPrice: { width: 86 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.one },
  totalLine: { textAlign: 'right' },
  suggestBox: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3E7ED', borderRadius: 12, marginTop: 4, overflow: 'hidden' },
  suggestItem: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 10 },

  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
