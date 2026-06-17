// Project «Διαδικασία» — native (Expo) port of the web ProjectProcess, 1:1 in
// structure: a full-screen chat-first project screen. Top bar (switcher pill +
// menu + «Προβολή ως πελάτης»), 5-step stepper, a chat timeline (messages as
// bubbles; offers / appointments / payments / requests as cards), and a bottom
// dock (Στοιχεία · Φωτό · Ραντεβού · Προσφορά + composer). Wired to the same live
// folder APIs the web uses.

import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfferPreviewSheet } from '@/components/offer-preview-sheet';
import { ThemedText } from '@/components/themed-text';
import { Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { dmyToYmd, formatDate, formatEuro, todayYMD } from '@/lib/format';
import { hapticSuccess } from '@/lib/haptics';

const STEPS = ['Επαφή', 'Προσφορά', 'Πληρωμή', 'Ραντεβού', 'Τέλος'] as const;
const STATUS_LABELS: Record<string, string> = { open: 'Νέο', in_progress: 'Σε εξέλιξη', done: 'Ολοκληρώθηκε', archived: 'Αρχειοθετήθηκε' };
const OFFER_STATUS_GR: Record<string, string> = {
  draft: 'Σε ετοιμασία', ready_to_send: 'Σε ετοιμασία', sent_manually: 'Απεστάλη', sent_provider: 'Απεστάλη',
  accepted: 'Αποδεκτή', rejected: 'Απορρίφθηκε', expired: 'Έληξε', cancelled: 'Ακυρώθηκε',
};
const APPT_TYPE_GR: Record<string, string> = { book_appointment: 'Ραντεβού', visit_customer: 'Επίσκεψη' };
const REQ_STATUS_GR: Record<string, string> = { pending: 'Σε αναμονή πελάτη', sent: 'Απεστάλη', opened: 'Ανοίχτηκε', submitted: 'Υποβλήθηκε', completed: 'Ολοκληρώθηκε', expired: 'Έληξε', revoked: 'Ακυρώθηκε' };
const PAY_KIND_GR: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };
const REJECT_MESSAGE = 'Καλησπέρα σας. Ευχαριστούμε πολύ για την επικοινωνία. Δυστυχώς δεν θα μπορέσουμε να αναλάβουμε τη συγκεκριμένη εργασία αυτή την περίοδο. Σας ευχόμαστε καλή συνέχεια και ελπίζουμε να βρείτε άμεσα την κατάλληλη λύση.';

const C_SUCCESS = '#18A06A';
const C_WARN = '#E0922F';
const C_DANGER = '#D14343';
const C_INK = '#1A3550'; // dark navy for the appointment icon (matches web --ink-2), theme-safe
const DOT_COLOR: Record<string, string> = { open: Brand.primary, in_progress: C_WARN, done: C_SUCCESS, archived: '#9AA6B2' };
const PAY_PCTS = [10, 20, 30, 50, 70, 100];

interface DetailOffer { id: string; offerNumber: string | null; status: string; total: number | null; createdAt: string }
interface DetailAppt { id: string; title: string; type: string; status: string; dueDate: string | null; dueTime: string | null }
interface DetailMsg { id: string; summary: string | null; direction: string; channel: string; createdAt: string }
interface DetailReq { id: string; status: string; createdAt: string }
interface FolderPayment { id: string; kind: string; pct: number | null; amount: number; status: string; createdAt: string }
interface FolderDetail {
  folder: { id: string; title: string; status: string; step?: number; notes?: string | null };
  customer: { id: string; name: string | null } | null;
  sections: {
    offers: { items: DetailOffer[] };
    appointments: { items: DetailAppt[] };
    messages: { items: DetailMsg[] };
    photos: { items: DetailReq[] };
    intake: { items: DetailReq[] };
  };
}
export interface ProjectInitial { id: string; title: string; status: string; step?: number }

const T = (s: string | null | undefined) => (s ? new Date(s).getTime() || 0 : 0);

type Item =
  | { kind: 'msg'; ts: number; data: DetailMsg }
  | { kind: 'offer'; ts: number; data: DetailOffer }
  | { kind: 'appt'; ts: number; data: DetailAppt }
  | { kind: 'payment'; ts: number; data: FolderPayment }
  | { kind: 'req'; ts: number; data: DetailReq; photos: boolean };

type SheetName = 'msg' | 'appt' | 'offer' | 'req' | 'payreq' | 'menu' | 'reject' | null;

export function ProjectProcess({
  visible, folderId, customerId, initial, onClose, onChanged,
}: {
  visible: boolean; folderId: string; customerId: string; initial: ProjectInitial; onClose: () => void; onChanged?: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [detail, setDetail] = useState<FolderDetail | null>(null);
  const [payments, setPayments] = useState<FolderPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const [sheet, setSheet] = useState<SheetName>(null);
  const [reqPhotos, setReqPhotos] = useState(false);
  const [msg, setMsg] = useState('');
  const [oDesc, setODesc] = useState('');
  const [oAmount, setOAmount] = useState('');
  const [aTitle, setATitle] = useState('');
  const [aDate, setADate] = useState('');
  const [payKind, setPayKind] = useState<'deposit' | 'balance'>('deposit');
  const [payPct, setPayPct] = useState(30);
  const [previewOfferId, setPreviewOfferId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, p] = await Promise.all([
        apiGet<{ ok?: boolean } & Partial<FolderDetail>>(`/api/folders/${folderId}`),
        apiGet<{ ok?: boolean; payments?: FolderPayment[] }>(`/api/folders/${folderId}/payment-requests`),
      ]);
      if (d?.ok && d.sections) { setDetail(d as FolderDetail); setError(false); } else setError(true);
      if (p?.ok) setPayments(p.payments ?? []);
    } catch { setError(true); } finally { setLoading(false); }
  }, [folderId]);

  useEffect(() => {
    if (visible) { setLoading(true); setError(false); void load(); }
  }, [visible, load]);

  const refresh = useCallback(async () => { await load(); onChanged?.(); }, [load, onChanged]);

  const offers = detail?.sections.offers.items ?? [];
  const firstOffer = offers[0];
  const f = detail?.folder;
  const status = f?.status ?? initial.status;
  const step = f?.step ?? initial.step ?? 0;
  const title = f?.title ?? initial.title;

  const timeline = useMemo<Item[]>(() => {
    if (!detail) return [];
    const s = detail.sections;
    const items: Item[] = [
      ...s.messages.items.filter((m) => m.channel !== 'call' && (m.summary ?? '').trim()).map((m): Item => ({ kind: 'msg', ts: T(m.createdAt), data: m })),
      ...s.offers.items.map((o): Item => ({ kind: 'offer', ts: T(o.createdAt), data: o })),
      ...s.appointments.items.map((a): Item => ({ kind: 'appt', ts: T(a.dueDate), data: a })),
      ...payments.map((p): Item => ({ kind: 'payment', ts: T(p.createdAt), data: p })),
      ...s.photos.items.map((u): Item => ({ kind: 'req', ts: T(u.createdAt), data: u, photos: true })),
      ...s.intake.items.map((i): Item => ({ kind: 'req', ts: T(i.createdAt), data: i, photos: false })),
    ];
    return items.sort((a, b) => a.ts - b.ts);
  }, [detail, payments]);

  // ── actions ──
  async function patchFolder(updates: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await apiPatch<{ ok?: boolean }>(`/api/folders/${folderId}`, updates);
      if (r?.ok) await refresh();
    } catch { Alert.alert('Σφάλμα', 'Η ενέργεια απέτυχε.'); } finally { setBusy(false); }
  }
  async function advanceStep() { await patchFolder({ step: Math.min(step + 1, 4) }); setSheet(null); }
  async function completeProject() { await patchFolder({ step: 4, status: 'done' }); setSheet(null); }

  async function post(path: string, body: unknown): Promise<boolean> {
    try {
      const r = await apiPost<{ ok?: boolean }>(path, body);
      return r?.ok === true;
    } catch (e) {
      Alert.alert('Σφάλμα', e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Η αποστολή απέτυχε.');
      return false;
    }
  }
  async function sendMessage() {
    const t = msg.trim(); if (!t) return;
    setBusy(true);
    try { if (await post(`/api/customers/${customerId}/message`, { text: t, workFolderId: folderId })) { setMsg(''); setSheet(null); void hapticSuccess(); await refresh(); } } finally { setBusy(false); }
  }
  async function sendRequest() {
    setBusy(true);
    try {
      const path = reqPhotos ? 'upload-link' : 'intake-link';
      if (await post(`/api/customers/${customerId}/${path}`, { mode: 'send', workFolderId: folderId })) { setSheet(null); await refresh(); }
    } finally { setBusy(false); }
  }
  async function submitOffer() {
    const desc = oDesc.trim(); const amount = Number(oAmount.replace(',', '.'));
    if (!desc || !isFinite(amount) || amount < 0) { Alert.alert('Προσφορά', 'Γράψε περιγραφή και ποσό.'); return; }
    setBusy(true);
    try { if (await post('/api/offers', { customerId, workFolderId: folderId, items: [{ description: desc, quantity: 1, unitPrice: amount }] })) { setODesc(''); setOAmount(''); setSheet(null); await refresh(); } } finally { setBusy(false); }
  }
  async function submitAppt() {
    const t = aTitle.trim(); if (!t) { Alert.alert('Ραντεβού', 'Γράψε τίτλο.'); return; }
    const raw = aDate.trim();
    const ymd = !raw ? todayYMD() : /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dmyToYmd(raw);
    if (!ymd) { Alert.alert('Ημερομηνία', 'Γράψε ημερομηνία ΗΗ-ΜΜ-ΕΕΕΕ.'); return; }
    setBusy(true);
    try { if (await post('/api/tasks', { customerId, workFolderId: folderId, title: t, type: 'book_appointment', dueDate: ymd })) { setATitle(''); setADate(''); setSheet(null); await refresh(); } } finally { setBusy(false); }
  }
  async function submitPayReq() {
    if (!firstOffer) return;
    setBusy(true);
    try { if (await post(`/api/folders/${folderId}/payment-request`, { kind: payKind, pct: payPct, offerId: firstOffer.id })) { setSheet(null); await refresh(); } } finally { setBusy(false); }
  }
  async function confirmPayment(id: string, st: 'confirmed' | 'cancelled') {
    setBusy(true);
    try {
      const r = await apiPatch<{ ok?: boolean }>(`/api/payments/${id}`, { status: st });
      if (r?.ok) await refresh();
    } catch { Alert.alert('Σφάλμα', 'Δεν ολοκληρώθηκε.'); } finally { setBusy(false); }
  }
  async function previewPortal() {
    setBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean; responseUrl?: string }>(`/api/folders/${folderId}/link`, { mode: 'open' });
      if (r?.ok && r.responseUrl) await WebBrowser.openBrowserAsync(r.responseUrl);
      else Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε ο σύνδεσμος.');
    } catch { Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε ο σύνδεσμος.'); } finally { setBusy(false); }
  }
  function rejectCustomer() {
    setBusy(true);
    void (async () => {
      try {
        await apiPost(`/api/customers/${customerId}/message`, { text: REJECT_MESSAGE }).catch(() => {});
        await apiPatch(`/api/customers/${customerId}`, { status: 'lost' }).catch(() => {});
        setSheet(null);
        onChanged?.();
        onClose();
      } finally { setBusy(false); }
    })();
  }

  const grossOf = (pct: number) => (firstOffer?.total != null ? Math.round(firstOffer.total * pct) / 100 : 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView edges={['top']} style={styles.fill}>
        {/* top bar */}
        <View style={styles.topbar}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={28} color={Brand.primary} />
          </Pressable>
          <View style={styles.switchPill}>
            <View style={[styles.dot, { backgroundColor: DOT_COLOR[status] ?? Brand.primary }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.switchTitle}>{title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {(detail?.customer?.name ?? 'Πελάτης')} · {STATUS_LABELS[status] ?? status}
              </ThemedText>
            </View>
          </View>
          <Pressable onPress={() => setSheet('menu')} hitSlop={8} style={styles.roundBtn}>
            <Ionicons name="ellipsis-horizontal" size={20} color={Brand.primary} />
          </Pressable>
          <Pressable onPress={() => void previewPortal()} hitSlop={8} style={styles.roundBtn}>
            <Ionicons name="eye-outline" size={20} color={Brand.primary} />
          </Pressable>
        </View>

        {/* stepper */}
        <View style={styles.stepper}>
          {STEPS.map((s, i) => {
            const done = i < step;
            const now = i === step;
            return (
              <View key={s} style={styles.stepWrap}>
                <View style={styles.stepCol}>
                  <View style={[styles.stepDot, done && styles.stepDotDone, now && styles.stepDotNow]}>
                    {done ? <Ionicons name="checkmark" size={13} color="#fff" /> : <ThemedText style={[styles.stepNum, now && styles.stepNumNow]}>{i + 1}</ThemedText>}
                  </View>
                  <ThemedText style={[styles.stepLabel, now && styles.stepLabelNow]} numberOfLines={1}>{s}</ThemedText>
                </View>
                {i < STEPS.length - 1 ? <View style={[styles.stepBar, done && styles.stepBarDone]} /> : null}
              </View>
            );
          })}
        </View>

        {/* timeline */}
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={Brand.primary} /></View>
        ) : error ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">Δεν φορτώθηκαν τα στοιχεία.</ThemedText>
            <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={() => { setLoading(true); void load(); }} />
          </View>
        ) : (
          <ScrollView style={styles.fill} contentContainerStyle={styles.body}>
            {timeline.map((it) => (
              <TimelineRow
                key={`${it.kind}:${it.data.id}`}
                it={it}
                busy={busy}
                c={c}
                styles={styles}
                onConfirm={confirmPayment}
                onPayReq={() => { setPayKind('deposit'); setPayPct(30); setSheet('payreq'); }}
                onOpenOffer={setPreviewOfferId}
              />
            ))}
            <ThemedText type="small" themeColor="textSecondary" style={styles.endHint}>
              Όλα όσα στέλνεις εδώ τα βλέπει ο πελάτης στο link του.
            </ThemedText>
          </ScrollView>
        )}

        {/* dock */}
        <SafeAreaView edges={['bottom']} style={styles.dockSafe}>
          <View style={styles.quickRow}>
            <DockBtn icon="clipboard-outline" label="Στοιχεία" styles={styles} onPress={() => { setReqPhotos(false); setSheet('req'); }} />
            <DockBtn icon="image-outline" label="Φωτό" styles={styles} onPress={() => { setReqPhotos(true); setSheet('req'); }} />
            <DockBtn icon="calendar-outline" label="Ραντεβού" styles={styles} onPress={() => { setATitle(title); setADate(''); setSheet('appt'); }} />
            <DockBtn icon="document-text-outline" label="Προσφορά" styles={styles} onPress={() => { setODesc(''); setOAmount(''); setSheet('offer'); }} />
          </View>
          <View style={styles.composer}>
            <Pressable onPress={() => setSheet('msg')} style={styles.composerAi} hitSlop={6}>
              <Ionicons name="sparkles" size={18} color={Brand.onPrimary} />
            </Pressable>
            <TextInput
              style={styles.composerInput}
              placeholder="Μήνυμα στον πελάτη…"
              placeholderTextColor={c.textFaint}
              value={msg}
              onChangeText={setMsg}
              onSubmitEditing={() => void sendMessage()}
              returnKeyType="send"
            />
            <Pressable onPress={() => void sendMessage()} style={styles.composerSend} hitSlop={6} disabled={!msg.trim()}>
              <Ionicons name="send" size={18} color={Brand.onPrimary} />
            </Pressable>
          </View>
        </SafeAreaView>
      </SafeAreaView>
      </KeyboardAvoidingView>

      {/* sheets */}
      <SheetModal visible={sheet === 'msg'} title="Μήνυμα στον πελάτη" onClose={() => setSheet(null)}>
        <Input value={msg} onChangeText={setMsg} placeholder="Γράψε μήνυμα…" multiline />
        <PrimaryButton label={busy ? 'Αποστολή…' : 'Αποστολή στο link'} busy={busy} disabled={!msg.trim()} onPress={() => void sendMessage()} />
      </SheetModal>

      <SheetModal visible={sheet === 'appt'} title="Αποστολή ραντεβού" onClose={() => setSheet(null)}>
        <Input label="Τίτλος" value={aTitle} onChangeText={setATitle} placeholder="π.χ. Επίσκεψη για μέτρηση" />
        <Input label="Ημερομηνία (ΗΗ-ΜΜ-ΕΕΕΕ)" value={aDate} onChangeText={setADate} placeholder={todayYMD().split('-').reverse().join('-')} />
        <PrimaryButton label={busy ? 'Αποστολή…' : 'Αποστολή στο link'} busy={busy} disabled={!aTitle.trim()} onPress={() => void submitAppt()} />
      </SheetModal>

      <SheetModal visible={sheet === 'offer'} title="Αποστολή προσφοράς" onClose={() => setSheet(null)}>
        <Input label="Περιγραφή" value={oDesc} onChangeText={setODesc} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
        <Input label="Ποσό (€)" value={oAmount} onChangeText={setOAmount} keyboardType="decimal-pad" placeholder="0" />
        <ThemedText type="smallBold" style={[styles.ink, { textAlign: 'right' }]}>Ποσό: {formatEuro(Number(oAmount.replace(',', '.')) || 0)}</ThemedText>
        <PrimaryButton label={busy ? 'Αποστολή…' : 'Αποστολή στο link'} busy={busy} disabled={!oDesc.trim()} onPress={() => void submitOffer()} />
      </SheetModal>

      <SheetModal visible={sheet === 'req'} title={reqPhotos ? 'Αίτημα φωτογραφιών' : 'Αίτημα στοιχείων'} onClose={() => setSheet(null)}>
        <View style={styles.infoBox}>
          <Ionicons name={reqPhotos ? 'image-outline' : 'clipboard-outline'} size={22} color={Brand.primary} />
          <ThemedText type="small" style={[styles.ink, { flex: 1 }]}>
            {reqPhotos ? 'Ο πελάτης θα ανεβάσει φωτογραφίες μέσα από το link του έργου.' : 'Ο πελάτης θα συμπληρώσει τα στοιχεία του (διεύθυνση, ΑΦΜ κ.λπ.) μέσα από το link.'}
          </ThemedText>
        </View>
        <PrimaryButton label={busy ? 'Αποστολή…' : 'Αποστολή αιτήματος'} busy={busy} onPress={() => void sendRequest()} />
      </SheetModal>

      <SheetModal visible={sheet === 'payreq'} title="Αίτημα πληρωμής" onClose={() => setSheet(null)}>
        {firstOffer ? (
          <>
            <View style={styles.seg}>
              {(['deposit', 'balance'] as const).map((k) => (
                <Pressable key={k} onPress={() => setPayKind(k)} style={[styles.segBtn, payKind === k && styles.segBtnOn]}>
                  <ThemedText type="small" style={[styles.segText, payKind === k && styles.segTextOn]}>{PAY_KIND_GR[k]}</ThemedText>
                </Pressable>
              ))}
            </View>
            <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: 6 }}>Ποσοστό</ThemedText>
            <View style={styles.pctRow}>
              {PAY_PCTS.map((p) => (
                <Pressable key={p} onPress={() => setPayPct(p)} style={[styles.pctChip, payPct === p && styles.pctChipOn]}>
                  <ThemedText type="small" style={[styles.pctText, payPct === p && styles.pctTextOn]}>{p}%</ThemedText>
                </Pressable>
              ))}
            </View>
            <View style={styles.amountBox}>
              <ThemedText type="small" themeColor="textSecondary">Ποσό αιτήματος (με ΦΠΑ)</ThemedText>
              <ThemedText style={styles.amountBig}>{formatEuro(grossOf(payPct))}</ThemedText>
            </View>
            <PrimaryButton label={busy ? 'Αποστολή…' : 'Αποστολή αιτήματος'} busy={busy} onPress={() => void submitPayReq()} />
          </>
        ) : (
          <View style={styles.infoBox}>
            <Ionicons name="document-text-outline" size={22} color={Brand.primary} />
            <ThemedText type="small" style={[styles.ink, { flex: 1 }]}>Πρόσθεσε πρώτα μια προσφορά για να ζητήσεις πληρωμή.</ThemedText>
          </View>
        )}
      </SheetModal>

      <SheetModal visible={sheet === 'menu'} title="Ενέργειες έργου" onClose={() => setSheet(null)}>
        <MenuItem icon="arrow-forward" label="Παράλειψη βήματος" styles={styles} c={c} onPress={() => void advanceStep()} />
        <MenuItem icon="checkmark-circle" label="Ολοκλήρωση έργου" styles={styles} c={c} tint={C_SUCCESS} onPress={() => void completeProject()} />
        <MenuItem icon="card-outline" label="Αίτημα πληρωμής" styles={styles} c={c} onPress={() => { setPayKind('deposit'); setPayPct(30); setSheet('payreq'); }} />
        <MenuItem icon="close-circle" label="Απόρριψη πελάτη" styles={styles} c={c} tint={C_DANGER} danger onPress={() => setSheet('reject')} />
      </SheetModal>

      <SheetModal visible={sheet === 'reject'} title="Απόρριψη πελάτη" onClose={() => setSheet(null)}>
        <View style={styles.infoBox}>
          <Ionicons name="chatbubble-outline" size={22} color={C_DANGER} />
          <ThemedText type="small" style={[styles.ink, { flex: 1 }]}>Στέλνουμε ένα ευγενικό μήνυμα στον πελάτη και σημαίνουμε τον πελάτη ως «Χαμένο».</ThemedText>
        </View>
        <View style={styles.quoteBox}><ThemedText type="small" style={styles.quoteText}>«{REJECT_MESSAGE}»</ThemedText></View>
        <PrimaryButton label={busy ? 'Αποστολή…' : 'Αποστολή & απόρριψη'} busy={busy} tone="danger" onPress={rejectCustomer} />
      </SheetModal>

      {/* offer preview (opened from the timeline «Άνοιγμα PDF» link) */}
      <OfferPreviewSheet offerId={previewOfferId} onClose={() => setPreviewOfferId(null)} onChanged={() => void refresh()} />
    </Modal>
  );
}

// ── timeline rows ──
function TimelineRow({
  it, busy, c, styles, onConfirm, onPayReq, onOpenOffer,
}: {
  it: Item; busy: boolean; c: ThemePalette; styles: ReturnType<typeof makeStyles>;
  onConfirm: (id: string, s: 'confirmed' | 'cancelled') => void; onPayReq: () => void; onOpenOffer: (id: string) => void;
}) {
  if (it.kind === 'msg') {
    const m = it.data; const tech = m.direction === 'outbound';
    return (
      <View style={[styles.bubbleRow, tech ? styles.rowRight : styles.rowLeft]}>
        <View style={[styles.bubble, tech ? styles.bubbleTech : styles.bubbleCust]}>
          <ThemedText type="small" style={tech ? styles.bubbleTextTech : styles.ink}>{(m.summary ?? '').trim()}</ThemedText>
          <ThemedText style={[styles.bubbleWhen, tech ? styles.bubbleWhenTech : undefined]}>{formatDate(m.createdAt)}</ThemedText>
        </View>
      </View>
    );
  }
  if (it.kind === 'offer') {
    const o = it.data; const accepted = o.status === 'accepted';
    return (
      <View style={styles.cardWrapRight}>
        <View style={styles.evCard}>
          <View style={styles.evTop}>
            <View style={[styles.evIc, { backgroundColor: Brand.primary }]}><Ionicons name="document-text" size={18} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText type="smallBold" style={styles.ink}>Προσφορά</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{o.offerNumber ?? '—'}</ThemedText>
            </View>
            <StatusPill label={OFFER_STATUS_GR[o.status] ?? o.status} tone={accepted ? 'ok' : 'warn'} styles={styles} />
          </View>
          {o.total != null ? (
            <View style={styles.evTotal}><ThemedText type="small" themeColor="textSecondary">Σύνολο</ThemedText><ThemedText type="smallBold" style={styles.ink}>{formatEuro(o.total)}</ThemedText></View>
          ) : null}
          <View style={styles.evFoot}>
            <View style={[styles.evDot, { backgroundColor: Brand.primary }]} />
            <ThemedText type="small" themeColor="textSecondary">Εσύ</ThemedText>
            <Pressable onPress={() => onOpenOffer(o.id)} hitSlop={6} style={styles.pdfLink}>
              <Ionicons name="document-text-outline" size={14} color={Brand.primary} />
              <ThemedText type="small" style={styles.pdfLinkText}>Άνοιγμα PDF</ThemedText>
            </Pressable>
          </View>
        </View>
        {accepted ? (
          <View style={styles.acceptedBox}>
            <View style={styles.acceptedIc}><Ionicons name="checkmark" size={18} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText type="smallBold" style={styles.ink}>Η προσφορά έγινε αποδεκτή</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Ζήτα προκαταβολή ή εξόφληση</ThemedText>
            </View>
            <Pressable onPress={onPayReq} style={styles.acceptedBtn}><ThemedText type="small" style={styles.acceptedBtnText}>Αίτημα πληρωμής</ThemedText></Pressable>
          </View>
        ) : null}
      </View>
    );
  }
  if (it.kind === 'appt') {
    const a = it.data; const confirmed = a.status === 'completed';
    return (
      <View style={styles.cardWrapRight}>
        <View style={styles.evCard}>
          <View style={styles.evTop}>
            <View style={[styles.evIc, { backgroundColor: C_INK }]}><Ionicons name="calendar" size={18} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText type="smallBold" style={styles.ink}>Ραντεβού</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{a.title}</ThemedText>
            </View>
            <StatusPill label={confirmed ? 'Ολοκληρώθηκε' : APPT_TYPE_GR[a.type] ?? 'Ραντεβού'} tone={confirmed ? 'ok' : 'warn'} styles={styles} />
          </View>
          {a.dueDate ? (
            <View style={styles.evAppt}><Ionicons name="time-outline" size={16} color={Brand.primary} /><ThemedText type="smallBold" style={styles.ink}>{formatDate(a.dueDate)}</ThemedText>{a.dueTime ? <ThemedText type="small" themeColor="textSecondary">· {a.dueTime}</ThemedText> : null}</View>
          ) : null}
          <View style={styles.evFoot}><View style={[styles.evDot, { backgroundColor: Brand.primary }]} /><ThemedText type="small" themeColor="textSecondary">Εσύ</ThemedText></View>
        </View>
      </View>
    );
  }
  if (it.kind === 'payment') {
    const p = it.data; const final = p.status === 'confirmed' || p.status === 'cancelled';
    const sub = p.status === 'confirmed' ? 'Πληρώθηκε — επιβεβαιωμένο' : p.status === 'declared' ? 'Ο πελάτης δήλωσε κατάθεση' : p.status === 'cancelled' ? 'Ακυρώθηκε' : 'Σε αναμονή κατάθεσης';
    return (
      <View style={styles.cardWrapRight}>
        <View style={styles.evCard}>
          <View style={styles.evTop}>
            <View style={[styles.evIc, { backgroundColor: C_SUCCESS }]}><Ionicons name="card" size={18} color="#fff" /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ThemedText type="smallBold" style={styles.ink} numberOfLines={1}>{PAY_KIND_GR[p.kind] ?? p.kind}{p.pct != null ? ` · ${p.pct}%` : ''} · {formatEuro(p.amount)}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{sub}</ThemedText>
            </View>
            <StatusPill label={p.status === 'confirmed' ? '✓' : '…'} tone={p.status === 'confirmed' ? 'ok' : 'warn'} styles={styles} />
          </View>
          {!final ? (
            <View style={styles.payActions}>
              <Pressable onPress={() => onConfirm(p.id, 'confirmed')} style={[styles.acceptedBtn, busy && styles.dim]}><ThemedText type="small" style={styles.acceptedBtnText}>Επιβεβαίωση είσπραξης</ThemedText></Pressable>
              <Pressable onPress={() => onConfirm(p.id, 'cancelled')} hitSlop={6}><ThemedText type="small" themeColor="textSecondary" style={{ fontWeight: '700' }}>Ακύρωση</ThemedText></Pressable>
            </View>
          ) : null}
        </View>
      </View>
    );
  }
  const r = it.data; const done = r.status === 'submitted' || r.status === 'completed';
  return (
    <View style={styles.cardWrapRight}>
      <View style={styles.evCard}>
        <View style={styles.evTop}>
          <View style={[styles.evIc, { backgroundColor: C_WARN }]}><Ionicons name={it.photos ? 'image-outline' : 'clipboard-outline'} size={18} color="#fff" /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText type="smallBold" style={styles.ink}>{it.photos ? 'Αίτημα φωτογραφιών' : 'Αίτημα στοιχείων'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{REQ_STATUS_GR[r.status] ?? r.status}</ThemedText>
          </View>
          <StatusPill label={done ? '✓' : '…'} tone={done ? 'ok' : 'warn'} styles={styles} />
        </View>
        <View style={styles.evFoot}><View style={[styles.evDot, { backgroundColor: Brand.primary }]} /><ThemedText type="small" themeColor="textSecondary">Εσύ</ThemedText></View>
      </View>
    </View>
  );
}

function StatusPill({ label, tone, styles }: { label: string; tone: 'ok' | 'warn'; styles: ReturnType<typeof makeStyles> }) {
  return <View style={[styles.pill, tone === 'ok' ? styles.pillOk : styles.pillWarn]}><ThemedText style={[styles.pillText, tone === 'ok' ? styles.pillTextOk : styles.pillTextWarn]}>{label}</ThemedText></View>;
}

function DockBtn({ icon, label, onPress, styles }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; styles: ReturnType<typeof makeStyles> }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.dockBtn, pressed && styles.dim]}>
      <Ionicons name={icon} size={19} color={Brand.primary} />
      <ThemedText type="small" style={styles.dockLabel}>{label}</ThemedText>
    </Pressable>
  );
}

function MenuItem({ icon, label, onPress, styles, c, tint, danger }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; styles: ReturnType<typeof makeStyles>; c: ThemePalette; tint?: string; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && styles.dim]}>
      <View style={[styles.menuIc, { backgroundColor: tint ? `${tint}22` : Brand.primarySoft }]}>
        <Ionicons name={icon} size={19} color={tint ?? Brand.primary} />
      </View>
      <ThemedText type="smallBold" style={[styles.ink, danger && { color: C_DANGER }]}>{label}</ThemedText>
    </Pressable>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1, backgroundColor: c.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.four },
  ink: { color: c.text },

  topbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderFaint, backgroundColor: c.card },
  iconBtn: { padding: 4 },
  switchPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.borderFaint },
  switchTitle: { color: c.text },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  roundBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.primarySoft },

  stepper: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.three, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.borderFaint, backgroundColor: c.card },
  stepWrap: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
  stepCol: { alignItems: 'center', gap: 5, width: 52 },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1.5, borderColor: c.border },
  stepDotDone: { backgroundColor: C_SUCCESS, borderColor: 'transparent' },
  stepDotNow: { backgroundColor: Brand.primary, borderColor: 'transparent' },
  stepNum: { fontSize: 12, fontWeight: '800', color: c.textFaint },
  stepNumNow: { color: '#fff' },
  stepLabel: { fontSize: 10, fontWeight: '600', color: c.textFaint },
  stepLabelNow: { color: Brand.primary },
  stepBar: { flex: 1, height: 2, borderRadius: 2, backgroundColor: c.border, marginTop: 11 },
  stepBarDone: { backgroundColor: C_SUCCESS },

  body: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.five },
  endHint: { textAlign: 'center', marginTop: Spacing.two, paddingHorizontal: Spacing.four, lineHeight: 18 },

  // bubbles
  bubbleRow: { flexDirection: 'row', marginVertical: 2 },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9, gap: 3 },
  bubbleTech: { backgroundColor: Brand.primary, borderBottomRightRadius: 6 },
  bubbleCust: { backgroundColor: c.surface, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: c.borderFaint },
  bubbleTextTech: { color: '#fff' },
  bubbleWhen: { fontSize: 11, color: c.textFaint, alignSelf: 'flex-end' },
  bubbleWhenTech: { color: 'rgba(255,255,255,0.8)' },

  // event cards (right-aligned, technician side)
  cardWrapRight: { alignItems: 'flex-end' },
  evCard: { width: '94%', backgroundColor: c.surface, borderRadius: 16, borderWidth: 1, borderColor: c.borderFaint, borderTopWidth: 2.5, borderTopColor: Brand.primary, padding: Spacing.three, gap: Spacing.two },
  evTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  evIc: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  evTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: c.borderFaint, paddingTop: 10 },
  evAppt: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  evFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  evDot: { width: 7, height: 7, borderRadius: 4 },
  pdfLink: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  pdfLinkText: { color: Brand.primary, fontWeight: '700' },

  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  pillOk: { backgroundColor: `${C_SUCCESS}22` },
  pillWarn: { backgroundColor: `${C_WARN}22` },
  pillText: { fontSize: 11, fontWeight: '800' },
  pillTextOk: { color: C_SUCCESS },
  pillTextWarn: { color: C_WARN },

  acceptedBox: { width: '94%', flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 16, marginTop: Spacing.two, backgroundColor: `${C_SUCCESS}14`, borderWidth: 1, borderColor: `${C_SUCCESS}40` },
  acceptedIc: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C_SUCCESS },
  acceptedBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: C_SUCCESS },
  acceptedBtnText: { color: '#fff', fontWeight: '700' },
  payActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },

  // dock
  dockSafe: { borderTopWidth: 1, borderTopColor: c.borderFaint, backgroundColor: c.card },
  quickRow: { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.three, paddingTop: 10 },
  dockBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 9, borderRadius: 14, backgroundColor: Brand.primarySoft },
  dockLabel: { fontSize: 11.5, fontWeight: '600', color: c.text },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: Spacing.three, paddingVertical: 10 },
  composerAi: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.primary },
  composerInput: { flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15, color: c.text },
  composerSend: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.primary },

  // sheets
  infoBox: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: c.surface, borderRadius: 16, padding: 15, marginBottom: Spacing.two },
  quoteBox: { marginTop: 4, marginBottom: Spacing.two, padding: 12, borderRadius: 12, backgroundColor: c.surface },
  quoteText: { color: c.textSecondary, fontStyle: 'italic', lineHeight: 20 },
  seg: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: 14, padding: 4, marginBottom: 16, borderWidth: 1, borderColor: c.borderFaint },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  segBtnOn: { backgroundColor: c.card },
  segText: { color: c.textSecondary, fontWeight: '700' },
  segTextOn: { color: Brand.primary },
  pctRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pctChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  pctChipOn: { backgroundColor: Brand.primary, borderColor: 'transparent' },
  pctText: { color: c.text, fontWeight: '700' },
  pctTextOn: { color: '#fff' },
  amountBox: { backgroundColor: Brand.primarySoft, borderRadius: 16, padding: 16, marginBottom: 16, alignItems: 'center', gap: 3 },
  amountBig: { fontSize: 28, fontWeight: '800', color: Brand.primary, letterSpacing: -0.6 },

  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, borderRadius: 14, backgroundColor: c.surface, marginBottom: 9 },
  menuIc: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },

  dim: { opacity: 0.6 },
});
