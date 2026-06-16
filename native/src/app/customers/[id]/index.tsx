// Customer workspace — messenger timeline + composer + info panel (web parity).
// Timeline: GET /api/customers/[id]/timeline. Tappable bubbles: call → full-brief
// modal, offer → OfferPreviewSheet, upload → info panel (gallery). Composer:
// Ραντεβού, Προσφορά (with catalog autosuggest), Αίτημα στοιχείων / φωτογραφιών
// (two separate direct-send actions, like the web ChatComposerSheet).

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfferPreviewSheet } from '@/components/offer-preview-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, BrandGradient, Shadow, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { hapticSelect, hapticSuccess } from '@/lib/haptics';
import { dmyToYmd, formatEuro, formatWhen } from '@/lib/format';
import type { CatalogItem, Customer, LinkDraft, TimelineItem, WorkFolder } from '@/lib/types';
import { pickAndUploadPhotos } from '@/lib/upload';

/** Pull the gist ("Σύνοψη") out of an AI call brief — the lines between the
 *  «AI brief …:» prefix and the first «Λεπτομέρειες:» / «Επόμενα βήματα:»
 *  heading (or the metadata-brief body). Used for the "what the customer is
 *  waiting for" banner at the top of the chat. */
function extractBriefGist(text: string | null | undefined): string | null {
  if (!text) return null;
  let t = text.trim().replace(/^AI brief[^\n:]*:?\s*/i, '');
  const stop = t.search(/\n\s*(Λεπτομέρειες|Επόμενα βήματα)\s*:/);
  if (stop >= 0) t = t.slice(0, stop);
  t = t.split(/\n-{3,}\n/)[0].trim();
  return t.length > 0 ? t : null;
}

// Process-step caption for the chat-first folder strip (mirrors WORK_FOLDER_STEPS).
const ERGO_STEP_LABELS = ['Επαφή', 'Προσφορά', 'Πληρωμή', 'Ραντεβού', 'Τέλος'];
function ergoStepCaption(step: number | undefined): string {
  const i = typeof step === 'number' && Number.isFinite(step) ? Math.max(0, Math.min(Math.trunc(step), 4)) : 0;
  return `Βήμα ${i + 1}/5 · ${ERGO_STEP_LABELS[i]}`;
}

export default function CustomerWorkspaceScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [suggested, setSuggested] = useState<Array<{ id: string; actionType: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [apptOpen, setApptOpen] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [msgOpen, setMsgOpen] = useState(false);
  const [briefItem, setBriefItem] = useState<TimelineItem | null>(null);
  const [previewOfferId, setPreviewOfferId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [folders, setFolders] = useState<WorkFolder[]>([]);
  const activeFolders = useMemo(
    () => folders.filter((f) => f.status === 'open' || f.status === 'in_progress'),
    [folders],
  );

  // Chat-first folder strip: load the customer's Έργα (best-effort; never blocks chat).
  useEffect(() => {
    if (!id) return;
    let alive = true;
    void apiGet<{ ok?: boolean; folders?: WorkFolder[] }>(`/api/customers/${id}/folders`)
      .then((r) => {
        if (alive) setFolders(r?.folders ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

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

  // Refetch on focus too (not just mount): edits made on the profile page and
  // briefs/responses that landed while the screen was open appear on pop-back.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const callPhone = customer?.mobilePhone || customer?.phone || customer?.landlinePhone || '';

  // "Τι περιμένει ο πελάτης": prefer the gist of the most recent call brief,
  // otherwise the AI memory fields on the customer. items are newest-first.
  const latestBriefItem = useMemo(
    () => items.find((it) => it.type === 'call' && it.payload?.hasBrief && !!it.body) ?? null,
    [items],
  );
  const waiting = useMemo(
    () =>
      extractBriefGist(latestBriefItem?.body) ||
      customer?.nextBestAction ||
      customer?.statusSummary ||
      customer?.needsSummary ||
      null,
    [latestBriefItem, customer],
  );

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
            if (r?.sent) { void hapticSuccess(); Alert.alert('✓', `Στάλθηκε αίτημα ${label}.`); }
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
    Alert.alert('Στοιχεία & αρχεία', undefined, [
      { text: 'Ανέβασμα φωτογραφίας (από εμένα)', onPress: photoSource },
      { text: 'Αίτημα στοιχείων (στον πελάτη)', onPress: () => sendRequest('intake') },
      { text: 'Αίτημα φωτογραφιών (στον πελάτη)', onPress: () => sendRequest('upload') },
      { text: 'Ακύρωση', style: 'cancel' },
    ]);
  }

  function photoSource() {
    Alert.alert('Ανέβασμα φωτογραφίας', undefined, [
      { text: 'Κάμερα', onPress: () => void runUpload('camera') },
      { text: 'Από συλλογή', onPress: () => void runUpload('library') },
      { text: 'Ακύρωση', style: 'cancel' },
    ]);
  }

  async function runUpload(src: 'camera' | 'library') {
    setSending(true);
    try {
      const r = await pickAndUploadPhotos(String(id), src);
      if (r.ok) {
        Alert.alert('✓', `Ανέβηκε ${r.count > 1 ? `${r.count} φωτογραφίες` : 'η φωτογραφία'}.`);
        void load();
      } else if (r.error !== 'canceled') {
        Alert.alert('Σφάλμα', r.error);
      }
    } finally {
      setSending(false);
    }
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
    void hapticSelect();
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
          <PrimaryButton
            label="Δοκίμασε ξανά"
            onPress={() => {
              setLoading(true);
              void load();
            }}
          />
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

      {/* What the customer is waiting for — from the latest AI call brief */}
      {waiting ? (
        <Pressable
          onPress={() => latestBriefItem && setBriefItem(latestBriefItem)}
          disabled={!latestBriefItem}
          style={({ pressed }) => [styles.waitingCard, pressed && !!latestBriefItem && styles.pressed]}>
          <View style={styles.waitingHead}>
            <Ionicons name="hourglass-outline" size={14} color={Brand.primary} />
            <ThemedText type="smallBold" style={styles.waitingTitle}>
              Τι περιμένει ο πελάτης
            </ThemedText>
          </View>
          <ThemedText type="small" style={styles.waitingText} numberOfLines={3}>
            {waiting}
          </ThemedText>
          {latestBriefItem ? (
            <ThemedText type="small" style={styles.waitingHint}>
              Προβολή περίληψης ›
            </ThemedText>
          ) : null}
        </Pressable>
      ) : null}

      {/* Chat-first: active Έργα for this customer (tap → folder section in info) */}
      {activeFolders.length > 0 ? (
        <View style={{ paddingHorizontal: Spacing.three, paddingTop: Spacing.two }}>
          <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.one, fontWeight: '600' }}>
            Ανοιχτά έργα · {activeFolders.length}
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.two, paddingRight: Spacing.three }}>
            {activeFolders.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => router.push({ pathname: '/customers/[id]/info', params: { id: String(id) } } as never)}
                style={({ pressed }) => [
                  { width: 184, borderRadius: 14, padding: Spacing.three, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderFaint },
                  pressed && { opacity: 0.7 },
                ]}>
                <ThemedText numberOfLines={1} style={{ color: c.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 }}>
                  ΕΡΓΟ
                </ThemedText>
                <ThemedText type="smallBold" numberOfLines={1} style={{ color: c.text }}>
                  {f.title}
                </ThemedText>
                <ThemedText type="small" numberOfLines={1} style={{ color: Brand.primary, fontWeight: '600' }}>
                  {ergoStepCaption(f.step)}
                </ThemedText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

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
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={Brand.primary} />
          }
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
          <ComposerButton icon="chatbubble-ellipses" label="Μήνυμα" onPress={() => setMsgOpen(true)} />
          <ComposerButton icon="calendar" label="Ραντεβού" onPress={() => setApptOpen(true)} />
          <ComposerButton icon="document-text" label="Προσφορά" onPress={() => setOfferOpen(true)} />
          <ComposerButton icon="link" label="Αίτημα" onPress={chooseRequest} busy={sending} />
        </View>
      </SafeAreaView>

      {/* Sheets / modals */}
      <MessageModal
        visible={msgOpen}
        customerId={customer.id}
        customerName={customer.name ?? null}
        customerAddress={customer.address ?? null}
        onClose={() => setMsgOpen(false)}
        onDone={() => {
          setMsgOpen(false);
          void load();
        }}
      />
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
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
        {us ? <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} /> : null}
        <View style={styles.bubbleHead}>
          <Ionicons name={meta.icon} size={14} color={us ? '#FFFFFF' : c.textSecondary} />
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [styles.composerBtn, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={Brand.onPrimary} size="small" /> : <Ionicons name={icon} size={18} color={Brand.onPrimary} />}
      <ThemedText style={styles.composerBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</ThemedText>
    </Pressable>
  );
}

// ---------- message modal (free text + snippets) ----------

interface SnippetLite {
  id: string;
  title: string;
  body: string;
}

function fillTokens(body: string, name: string | null, address: string | null): string {
  return body
    .replace(/\{όνομα\}/g, name?.trim() || '')
    .replace(/\{διεύθυνση\}/g, address?.trim() || '')
    .replace(/\{ημερομηνία\}/g, '')
    .replace(/\{ώρα\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!;])/g, '$1')
    .trim();
}

function MessageModal({
  visible,
  customerId,
  customerName,
  customerAddress,
  onClose,
  onDone,
}: {
  visible: boolean;
  customerId: string;
  customerName: string | null;
  customerAddress: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [snippets, setSnippets] = useState<SnippetLite[] | null>(null);
  const [showSnippets, setShowSnippets] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [pending, setPending] = useState<Array<{ id: string; body: string; scheduledFor: string }>>([]);

  const loadPending = useCallback(async () => {
    try {
      const res = await apiGet<{ ok?: boolean; messages?: Array<{ id: string; body: string; scheduledFor: string }> }>(
        `/api/customers/${customerId}/scheduled-messages`,
      );
      setPending(res?.messages ?? []);
    } catch {
      setPending([]);
    }
  }, [customerId]);

  useEffect(() => {
    if (visible) {
      setText('');
      setShowSnippets(false);
      setScheduleMode(false);
      setSchedDate('');
      setSchedTime('');
      void loadPending();
    }
  }, [visible, loadPending]);

  async function cancelPending(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
    try { await apiDelete(`/api/scheduled-messages/${id}`); } catch { void loadPending(); }
  }

  async function schedule() {
    const t = text.trim();
    if (!t) return;
    const ymd = dmyToYmd(schedDate);
    if (!ymd) {
      Alert.alert('Ημερομηνία', 'Γράψε ημερομηνία ως ΗΗ-ΜΜ-ΕΕΕΕ.');
      return;
    }
    const time = schedTime.trim() || '10:00';
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      Alert.alert('Ώρα', 'Γράψε ώρα ως ΩΩ:ΛΛ (π.χ. 10:00).');
      return;
    }
    const when = new Date(`${ymd}T${time.padStart(5, '0')}:00`);
    if (isNaN(when.getTime()) || when.getTime() < Date.now()) {
      Alert.alert('Ημερομηνία', 'Διάλεξε μελλοντική ημερομηνία/ώρα.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; error?: string }>(`/api/customers/${customerId}/scheduled-messages`, {
        text: t,
        scheduledFor: when.toISOString(),
      });
      if (res?.ok) {
        Alert.alert('✓', 'Το μήνυμα προγραμματίστηκε. Θα σταλεί αυτόματα.');
        onDone();
      } else {
        Alert.alert('Σφάλμα', res?.error === 'no_phone' ? 'Ο πελάτης δεν έχει τηλέφωνο.' : 'Ο προγραμματισμός απέτυχε.');
      }
    } catch {
      Alert.alert('Σφάλμα', 'Ο προγραμματισμός απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  async function loadSnippets() {
    if (snippets !== null) {
      setShowSnippets((v) => !v);
      return;
    }
    setShowSnippets(true);
    try {
      const res = await apiGet<{ ok?: boolean; snippets?: SnippetLite[] }>('/api/snippets');
      setSnippets(res?.snippets ?? []);
    } catch {
      setSnippets([]);
    }
  }

  async function draftReply() {
    if (drafting) return;
    setDrafting(true);
    try {
      const res = await apiPost<{ ok?: boolean; draft?: string; error?: string }>(
        `/api/customers/${customerId}/reply-draft`,
        text.trim() ? { hint: text.trim() } : {},
      );
      if (res?.ok && res.draft) setText(res.draft);
      else Alert.alert('AI', res?.error === 'ai_not_configured' ? 'Ο AI βοηθός δεν είναι ρυθμισμένος.' : 'Δεν δημιουργήθηκε πρόταση.');
    } catch {
      Alert.alert('AI', 'Δεν δημιουργήθηκε πρόταση.');
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; error?: string }>(`/api/customers/${customerId}/message`, { text: t });
      if (res?.ok) { void hapticSuccess(); onDone(); }
      else Alert.alert('Σφάλμα', res?.error === 'no_phone' ? 'Ο πελάτης δεν έχει τηλέφωνο.' : 'Το μήνυμα δεν στάλθηκε.');
    } catch {
      Alert.alert('Σφάλμα', 'Το μήνυμα δεν στάλθηκε.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} title="Μήνυμα στον πελάτη" onClose={onClose}>
      {pending.length > 0 ? (
        <View style={styles.pendingBox}>
          <ThemedText type="smallBold" style={styles.dark}>
            Προγραμματισμένα ({pending.length})
          </ThemedText>
          {pending.map((p) => (
            <View key={p.id} style={styles.pendingItem}>
              <View style={{ flex: 1 }}>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatWhen(p.scheduledFor)}
                </ThemedText>
                <ThemedText type="small" style={styles.dark} numberOfLines={1}>
                  {p.body}
                </ThemedText>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Ακύρωση"
                onPress={() => void cancelPending(p.id)}
                hitSlop={8}
                style={({ pressed }) => [pressed && styles.pressed]}>
                <Ionicons name="close-circle" size={22} color="#D14343" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Input label="Μήνυμα (Viber → SMS)" value={text} onChangeText={setText} placeholder="Γράψε ή διάλεξε πρότυπο…" multiline />
      <View style={styles.msgTools}>
        <Pressable onPress={() => void loadSnippets()} style={({ pressed }) => [styles.snippetToggle, pressed && styles.pressed]}>
          <Ionicons name="chatbox-ellipses-outline" size={16} color={Brand.primary} />
          <ThemedText type="small" style={{ color: Brand.primary, fontWeight: '700' }}>
            {showSnippets ? 'Κλείσιμο' : 'Πρότυπα'}
          </ThemedText>
        </Pressable>
        <Pressable onPress={() => void draftReply()} disabled={drafting} style={({ pressed }) => [styles.snippetToggle, (pressed || drafting) && styles.pressed]}>
          {drafting ? <ActivityIndicator size="small" color={Brand.primary} /> : <Ionicons name="sparkles" size={16} color={Brand.primary} />}
          <ThemedText type="small" style={{ color: Brand.primary, fontWeight: '700' }}>
            Πρόταση απάντησης
          </ThemedText>
        </Pressable>
      </View>
      {showSnippets ? (
        snippets === null ? (
          <ActivityIndicator color={Brand.primary} style={{ marginVertical: Spacing.two }} />
        ) : snippets.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Δεν υπάρχουν πρότυπα. Πρόσθεσέ τα από τις Ρυθμίσεις.
          </ThemedText>
        ) : (
          <View style={styles.snippetList}>
            {snippets.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  const filled = fillTokens(s.body, customerName, customerAddress);
                  setText((prev) => (prev ? `${prev} ${filled}` : filled));
                  setShowSnippets(false);
                }}
                style={({ pressed }) => [styles.snippetItem, pressed && styles.pressed]}>
                <ThemedText type="smallBold" style={styles.dark}>
                  {s.title}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {fillTokens(s.body, customerName, customerAddress)}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        )
      ) : null}
      <Pressable onPress={() => setScheduleMode((v) => !v)} style={({ pressed }) => [styles.snippetToggle, pressed && styles.pressed]}>
        <Ionicons name={scheduleMode ? 'time' : 'time-outline'} size={16} color={Brand.primary} />
        <ThemedText type="small" style={{ color: Brand.primary, fontWeight: '700' }}>
          {scheduleMode ? 'Άμεση αποστολή' : 'Αποστολή αργότερα'}
        </ThemedText>
      </Pressable>
      {scheduleMode ? (
        <>
          <View style={styles.dateChips}>
            {([
              ['Αύριο', 1],
              ['Μεθαύριο', 2],
            ] as const).map(([label, offset]) => (
              <Pressable
                key={label}
                onPress={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + offset);
                  const p = (n: number) => String(n).padStart(2, '0');
                  setSchedDate(`${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`);
                  if (!schedTime) setSchedTime('10:00');
                }}
                style={({ pressed }) => [styles.dateChip, pressed && styles.pressed]}>
                <ThemedText type="small" style={styles.dateChipText}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <Input label="Ημερομηνία (ΗΗ-ΜΜ-ΕΕΕΕ)" value={schedDate} onChangeText={setSchedDate} placeholder="15-06-2026" />
          <Input label="Ώρα" value={schedTime} onChangeText={setSchedTime} placeholder="10:00" />
          <PrimaryButton label="Προγραμματισμός" onPress={() => void schedule()} busy={busy} disabled={!text.trim() || !schedDate.trim()} />
        </>
      ) : (
        <PrimaryButton label="Αποστολή (Viber → SMS)" onPress={() => void send()} busy={busy} disabled={!text.trim()} />
      )}
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
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

    // Step 1: create the appointment. A failure HERE means nothing was saved.
    let createdTaskId: string;
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
      createdTaskId = res.task.id;
      setTaskId(createdTaskId);
    } catch {
      Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε το ραντεβού.');
      return;
    } finally {
      setBusy(false);
    }

    // Step 2: prepare the notify message. The appointment EXISTS now — a
    // failure here must not claim otherwise (retrying would double-book).
    setBusy(true);
    try {
      const d = await apiPost<LinkDraft>(`/api/customers/${customerId}/appointment-link`, {
        taskId: createdTaskId,
        mode: 'draft',
      });
      if (d?.message) setDraft(d);
      else onDone();
    } catch {
      Alert.alert(
        'Το ραντεβού αποθηκεύτηκε',
        'Το μήνυμα προς τον πελάτη δεν ετοιμάστηκε — μπορείς να το στείλεις από το προφίλ του.',
      );
      onDone();
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
          <View style={styles.dateChips}>
            {([
              ['Σήμερα', 0],
              ['Αύριο', 1],
              ['Μεθαύριο', 2],
            ] as const).map(([label, offset]) => (
              <Pressable
                key={label}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + offset);
                  const p = (n: number) => String(n).padStart(2, '0');
                  setDate(`${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`);
                }}
                style={({ pressed }) => [styles.dateChip, pressed && styles.pressed]}>
                <ThemedText type="small" style={styles.dateChipText}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [rows, setRows] = useState<DraftItem[]>([{ description: '', quantity: '1', unitPrice: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  // catalog autosuggest for the active row — debounced (one request per pause,
  // not per keystroke) and sequence-guarded (a slow old response can't
  // overwrite a newer one).
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<CatalogItem[]>([]);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestSeq = useRef(0);

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
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
      const q = v.trim();
      if (q.length >= 2) {
        const seq = ++suggestSeq.current;
        suggestTimer.current = setTimeout(() => {
          apiGet<{ ok?: boolean; items?: CatalogItem[] }>(`/api/catalog?q=${encodeURIComponent(q)}`)
            .then((res) => {
              if (seq === suggestSeq.current) setSuggestions((res?.items ?? []).slice(0, 5));
            })
            .catch(() => {});
        }, 300);
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

    // Step 1: create the offer. A failure HERE means nothing was saved.
    let createdOfferId: string;
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
      createdOfferId = res.offer.id;
      setOfferId(createdOfferId);
    } catch {
      Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε η προσφορά.');
      return;
    } finally {
      setBusy(false);
    }

    // Step 2: prepare the notify message. The offer EXISTS now — a failure
    // here must not claim otherwise (retrying would send a duplicate offer).
    setBusy(true);
    try {
      const d = await apiPost<LinkDraft>(`/api/offers/${createdOfferId}/notify`, { mode: 'draft' });
      if (d?.message) setDraft(d);
      else onDone();
    } catch {
      Alert.alert(
        'Η προσφορά αποθηκεύτηκε',
        'Το μήνυμα προς τον πελάτη δεν ετοιμάστηκε — μπορείς να τη στείλεις από το προφίλ του.',
      );
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!offerId) return;
    setBusy(true);
    try {
      const r = await apiPost<LinkDraft>(`/api/offers/${offerId}/notify`, { mode: 'send' });
      // The offer notify route reports its fallback cause as `reason`.
      if (r?.sent === false && (r.reason || r.fallbackReason)) Alert.alert('Αποστολή', `Δεν στάλθηκε αυτόματα (${r.reason ?? r.fallbackReason}). Δες την προσφορά για χειροκίνητη αποστολή.`);
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

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  dark: { color: c.text },

  headerSafe: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
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
  headerName: { fontSize: 16, color: c.text },
  headerSub: { fontSize: 12 },
  headerCall: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  onBlue: { color: '#FFFFFF' },
  onBlueMuted: { color: 'rgba(255,255,255,0.75)' },
  tapHintOnBlue: { color: '#FFFFFF', fontWeight: '700', textDecorationLine: 'underline' },

  waitingCard: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    backgroundColor: Brand.primarySoft,
    borderRadius: 14,
    padding: Spacing.three,
    gap: 4,
  },
  waitingHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waitingTitle: { color: Brand.primary },
  waitingText: { color: c.text },
  waitingHint: { color: Brand.primary, fontWeight: '700' },

  feed: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, gap: Spacing.two },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  rowUs: { justifyContent: 'flex-end' },
  rowCust: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 20, padding: Spacing.three, gap: 4, overflow: 'hidden' },
  bubbleUs: { backgroundColor: Brand.primary, borderBottomRightRadius: 5, ...Shadow.card },
  bubbleCust: { backgroundColor: c.card, borderBottomLeftRadius: 5, borderWidth: 1, borderColor: c.borderFaint, ...Shadow.card },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  when: { fontSize: 11, alignSelf: 'flex-end' },
  tapHint: { color: Brand.primary, fontWeight: '700' },

  suggestRow: { maxHeight: 44, borderTopWidth: 1, borderTopColor: c.border },
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

  composerSafe: { borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card },
  composer: { flexDirection: 'row', gap: Spacing.one, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
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
  composerBtnText: { color: Brand.onPrimary, fontWeight: '700', fontSize: 13 },

  msgBox: { backgroundColor: c.surface, borderRadius: 14, padding: Spacing.three },

  offerRow: { flexDirection: 'row', gap: Spacing.two },
  offerDesc: { flex: 2 },
  offerQty: { width: 64 },
  offerPrice: { width: 86 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.one },
  totalLine: { textAlign: 'right' },
  suggestBox: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 12, marginTop: 4, overflow: 'hidden' },
  suggestItem: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: 10 },

  pendingBox: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three, gap: Spacing.one },
  pendingItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 4 },
  msgTools: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  snippetToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.one },
  snippetList: { gap: Spacing.one },
  snippetItem: { backgroundColor: c.surface, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10 },

  dateChips: { flexDirection: 'row', gap: Spacing.two },
  dateChip: {
    paddingHorizontal: Spacing.three,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: Brand.primarySoft,
  },
  dateChipText: { color: Brand.primary, fontWeight: '700' },

  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
