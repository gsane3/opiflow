// Customer profile — Messenger-style contact page (pushed from the chat header;
// native slide-from-right + swipe-back). Big avatar, circular quick actions,
// grouped cards (Στοιχεία · Δραστηριότητα · Σημείωση) and the red destructive
// action at the bottom — like Messenger's contact screen.

import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfferPreviewSheet } from '@/components/offer-preview-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChipSelect, Input, ListRow, PrimaryButton, SheetModal } from '@/components/ui';
import { WorkFoldersSection } from '@/components/work-folders-section';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatDate, formatEuro } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Customer, GalleryFile, LinkDraft, Offer, Task, TimelineItem, UploadSession } from '@/lib/types';

const APPT_TYPES = new Set(['book_appointment', 'visit_customer']);

// First meaningful letter for the avatar, skipping common title prefixes
// (e.g. «κα Ιωάννα» → «Ι» instead of «Κ»).
const NAME_TITLE_RE = /^(κα|κ|κος|κο|κυρ|κυρία|κύριος|mr|mrs|ms)\.?$/i;
function avatarInitial(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const meaningful = parts.find((p) => !NAME_TITLE_RE.test(p)) ?? parts[0];
  return (meaningful ?? 'Π').slice(0, 1).toUpperCase();
}

// Polite default rejection message (identical to the web reject flow).
const REJECT_MESSAGE = 'Καλησπέρα σας. Ευχαριστούμε πολύ για την επικοινωνία. Δυστυχώς δεν θα μπορέσουμε να αναλάβουμε τη συγκεκριμένη εργασία αυτή την περίοδο. Σας ευχόμαστε καλή συνέχεια και ελπίζουμε να βρείτε άμεσα την κατάλληλη λύση.';

const STATUS_LABELS: Record<string, string> = {
  new: 'Νέος',
  in_progress: 'Σε εξέλιξη',
  won: 'Κερδισμένος',
  lost: 'Χαμένος',
};

const CHANNELS = [
  { key: 'phone', label: 'Τηλέφωνο' },
  { key: 'viber', label: 'Viber' },
  { key: 'sms', label: 'SMS' },
  { key: 'email', label: 'Email' },
];

const SOURCES = [
  { key: 'inbound_call', label: 'Κλήση' },
  { key: 'referral', label: 'Σύσταση' },
  { key: 'facebook_ads', label: 'Facebook' },
  { key: 'google_ads', label: 'Google' },
  { key: 'website_form', label: 'Site' },
  { key: 'manual_entry', label: 'Χειροκίνητα' },
  { key: 'other', label: 'Άλλο' },
];

const OFFER_STATUS_GR: Record<string, string> = {
  draft: 'Πρόχειρη',
  ready_to_send: 'Έτοιμη',
  sent_manually: 'Στάλθηκε',
  sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
};

type Expanded = 'offers' | 'appointments' | 'files' | 'calls' | null;

export default function CustomerProfileScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const customerId = String(id ?? '');

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [appts, setAppts] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [briefs, setBriefs] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Expanded>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [previewOfferId, setPreviewOfferId] = useState<string | null>(null);
  const [previewAppt, setPreviewAppt] = useState<Task | null>(null);
  const [apptDraft, setApptDraft] = useState<LinkDraft | null>(null);

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    try {
      const [cRes, oRes, tRes, feed, sRes] = await Promise.all([
        apiGet<{ ok?: boolean; customer?: Customer }>(`/api/customers/${customerId}`),
        apiGet<{ ok?: boolean; offers?: Offer[] }>(`/api/offers?customerId=${customerId}&limit=50`),
        apiGet<{ ok?: boolean; tasks?: Task[] }>(`/api/tasks?customerId=${customerId}&limit=100`),
        apiGet<{ ok?: boolean; items?: TimelineItem[] }>(`/api/customers/${customerId}/timeline`),
        supabase
          .from('customer_upload_sessions')
          .select('id, files, uploaded_at')
          .eq('customer_id', customerId)
          .order('uploaded_at', { ascending: false })
          .limit(20),
      ]);
      if (cRes?.customer) {
        const c = cRes.customer;
        setCustomer(c);
        setPinned((c as { pinned?: boolean }).pinned ?? false);
        setForm({
          name: c.name ?? '',
          companyName: c.companyName ?? '',
          mobilePhone: c.mobilePhone ?? '',
          landlinePhone: c.landlinePhone ?? '',
          email: c.email ?? '',
          address: c.address ?? '',
          preferredContactMethod: (c as { preferredContactMethod?: string }).preferredContactMethod ?? 'phone',
          source: c.source ?? 'other',
          needsSummary: c.needsSummary ?? '',
        });
        setNote(c.notes ?? '');
      }
      setOffers(oRes?.offers ?? []);
      setAppts((tRes?.tasks ?? []).filter((t) => APPT_TYPES.has(t.type)));
      setBriefs((feed?.items ?? []).filter((it) => it.type === 'call' && it.body).reverse());
      if (!sRes.error && Array.isArray(sRes.data)) setSessions(sRes.data as unknown as UploadSession[]);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const galleryFiles = useMemo<GalleryFile[]>(() => {
    const out: GalleryFile[] = [];
    for (const s of sessions)
      (s.files ?? []).forEach((f, idx) =>
        out.push({
          sessionId: s.id,
          fileIndex: idx,
          name: f.name,
          kind: f.kind === 'photo' ? 'image' : f.kind === 'video' ? 'video' : 'file',
        }),
      );
    return out;
  }, [sessions]);

  const resolveUrl = useCallback(
    async (file: GalleryFile): Promise<string | null> => {
      try {
        const res = await apiPost<{ ok?: boolean; signedUrl?: string }>(
          `/api/customers/${customerId}/files/signed-url`,
          { sessionId: file.sessionId, fileIndex: file.fileIndex },
        );
        return res?.ok && res.signedUrl ? res.signedUrl : null;
      } catch {
        return null;
      }
    },
    [customerId],
  );

  // Thumbnails when the files group expands — ONE batch request for all
  // sessions (the per-file endpoint cost 1 round-trip per thumbnail).
  useEffect(() => {
    if (expanded !== 'files' || sessions.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiPost<{
          ok?: boolean;
          files?: Array<{ sessionId: string; fileIndex: number; signedUrl: string | null }>;
        }>(`/api/customers/${customerId}/files/signed-urls`, {
          sessionIds: sessions.map((s) => s.id),
        });
        if (cancelled || !res?.ok || !Array.isArray(res.files)) return;
        const next: Record<string, string> = {};
        for (const f of res.files) {
          if (f.signedUrl) next[`${f.sessionId}:${f.fileIndex}`] = f.signedUrl;
        }
        setThumbs((t) => ({ ...t, ...next }));
      } catch {
        // thumbnails are progressive enhancement — tiles fall back to icons
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, sessions, customerId]);

  useEffect(() => {
    if (galleryIndex === null) {
      setGalleryUrl(null);
      return;
    }
    const f = galleryFiles[galleryIndex];
    if (!f) return;
    // Reuse the batch-signed URL when we already have it (valid for 10 min).
    const cached = thumbs[`${f.sessionId}:${f.fileIndex}`];
    if (cached) {
      setGalleryUrl(cached);
      return;
    }
    setGalleryUrl(null);
    void resolveUrl(f).then((u) => setGalleryUrl(u));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryIndex, galleryFiles, resolveUrl]);

  /** Videos and documents open externally (the lightbox renders images only). */
  function openFileTile(i: number) {
    const f = galleryFiles[i];
    if (!f) return;
    if (f.kind === 'image') {
      setGalleryIndex(i);
      return;
    }
    const cached = thumbs[`${f.sessionId}:${f.fileIndex}`];
    if (cached) {
      void Linking.openURL(cached).catch(() => Alert.alert('Σφάλμα', 'Δεν άνοιξε το αρχείο.'));
      return;
    }
    void resolveUrl(f).then((u) => {
      if (u) void Linking.openURL(u).catch(() => Alert.alert('Σφάλμα', 'Δεν άνοιξε το αρχείο.'));
      else Alert.alert('Σφάλμα', 'Δεν άνοιξε το αρχείο.');
    });
  }

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const callPhone = customer?.mobilePhone || customer?.phone || customer?.landlinePhone || '';

  async function togglePin() {
    const next = !pinned;
    setPinned(next);
    try {
      const res = await apiPost<{ ok?: boolean }>(`/api/customers/${customerId}/pin`, { pinned: next });
      if (!res?.ok) setPinned(!next);
    } catch {
      setPinned(!next);
    }
  }

  async function saveContact() {
    setBusy(true);
    try {
      const res = await apiPatch<{ ok?: boolean }>(`/api/customers/${customerId}`, {
        name: form.name || null,
        companyName: form.companyName || null,
        mobilePhone: form.mobilePhone || null,
        landlinePhone: form.landlinePhone || null,
        email: form.email || null,
        address: form.address || null,
        preferredContactMethod: form.preferredContactMethod || null,
        source: form.source || null,
        needsSummary: form.needsSummary || null,
      });
      if (res?.ok) {
        setEditOpen(false);
        void load();
      } else Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    setBusy(true);
    try {
      await apiPatch(`/api/customers/${customerId}`, { notes: note || null });
      Alert.alert('✓', 'Η σημείωση αποθηκεύτηκε.');
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  async function markLost(notify: boolean) {
    try {
      await apiPatch(`/api/customers/${customerId}`, { status: 'lost' });
      if (notify) {
        const r = await apiPost<{ ok?: boolean }>(`/api/customers/${customerId}/message`, { text: REJECT_MESSAGE });
        if (r?.ok) Alert.alert('✓', 'Ο πελάτης σημάνθηκε ως «Χαμένος» και στάλθηκε ενημέρωση.');
        else Alert.alert('Σημειώθηκε', 'Σημάνθηκε ως «Χαμένος», αλλά το μήνυμα δεν στάλθηκε (λείπει τηλέφωνο;).');
      }
      void load();
    } catch {
      Alert.alert('Σφάλμα', 'Απέτυχε.');
    }
  }

  function rejectCustomer() {
    if (customer?.status === 'lost') return;
    Alert.alert('Απόρριψη πελάτη', 'Ο πελάτης θα σημανθεί ως «Χαμένος».', [
      { text: 'Απόρριψη + ενημέρωση πελάτη', onPress: () => void markLost(true) },
      { text: 'Απόρριψη χωρίς μήνυμα', style: 'destructive', onPress: () => void markLost(false) },
      { text: 'Ακύρωση', style: 'cancel' },
    ]);
  }

  async function sendApptLink(t: Task) {
    setBusy(true);
    try {
      const d = await apiPost<LinkDraft>(`/api/customers/${customerId}/appointment-link`, { taskId: t.id, mode: 'draft' });
      if (d?.message) setApptDraft(d);
      else Alert.alert('Αποστολή', d?.error ?? 'Δεν υπάρχει διαθέσιμο μήνυμα.');
    } catch {
      Alert.alert('Σφάλμα', 'Απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSendApptLink(t: Task) {
    setBusy(true);
    try {
      const r = await apiPost<LinkDraft>(`/api/customers/${customerId}/appointment-link`, {
        taskId: t.id,
        mode: 'send',
        channel: 'viber',
      });
      if (r?.sent === false && r.fallbackReason) Alert.alert('Αποστολή', `Εναλλακτικό κανάλι: ${r.fallbackReason}`);
      setApptDraft(null);
      setPreviewAppt(null);
    } catch {
      Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  const win = Dimensions.get('window');
  const toggle = (key: Exclude<Expanded, null>) => setExpanded((e) => (e === key ? null : key));

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={30} color={Brand.primary} />
        </Pressable>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Brand.primary} />
        </View>
      ) : !customer ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">
            {loadError ? 'Σφάλμα σύνδεσης.' : 'Δεν βρέθηκε ο πελάτης.'}
          </ThemedText>
          <PrimaryButton label="Δοκίμασε ξανά" onPress={() => void load()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Hero — like Messenger's profile header */}
          <View style={styles.hero}>
            <View style={styles.avatar}>
              <ThemedText style={styles.avatarText}>
                {avatarInitial(customer.name)}
              </ThemedText>
            </View>
            <ThemedText type="subtitle" style={styles.name}>
              {customer.name ?? 'Πελάτης'}
            </ThemedText>
            {customer.companyName ? (
              <ThemedText type="small" themeColor="textSecondary">
                {customer.companyName}
              </ThemedText>
            ) : null}
            {customer.status ? (
              <View style={styles.badge}>
                <ThemedText style={styles.badgeText}>{STATUS_LABELS[customer.status] ?? customer.status}</ThemedText>
              </View>
            ) : null}

            {/* Circular quick actions */}
            <View style={styles.quickRow}>
              <Quick
                icon="call"
                label="Κλήση"
                disabled={!callPhone}
                onPress={() => router.push({ pathname: '/calls', params: { num: callPhone } })}
              />
              <Quick
                icon="chatbubble"
                label="SMS"
                disabled={!callPhone}
                onPress={() => Linking.openURL(`sms:${callPhone}`)}
              />
              <Quick
                icon="map"
                label="Χάρτης"
                disabled={!customer.address}
                onPress={() =>
                  Linking.openURL(
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address ?? '')}`,
                  )
                }
              />
              <Quick icon="create" label="Επεξεργασία" onPress={() => setEditOpen(true)} />
              <Quick
                icon={pinned ? 'bookmark' : 'bookmark-outline'}
                label={pinned ? 'Καρφιτσωμένο' : 'Καρφίτσωμα'}
                onPress={() => void togglePin()}
              />
            </View>
          </View>

          {/* Στοιχεία */}
          <GroupCard title="Στοιχεία">
            <InfoRow icon="call" label="Κινητό" value={customer.mobilePhone} />
            <InfoRow icon="call-outline" label="Σταθερό" value={customer.landlinePhone} />
            <InfoRow icon="mail" label="Email" value={customer.email} />
            <InfoRow icon="location" label="Διεύθυνση" value={customer.address} />
            <InfoRow icon="sparkles" label="Ανάγκες" value={customer.needsSummary} />
            {!customer.mobilePhone && !customer.landlinePhone && !customer.email && !customer.address ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
                Δεν υπάρχουν στοιχεία — πάτα «Επεξ/σία».
              </ThemedText>
            ) : null}
          </GroupCard>

          {/* Φάκελοι εργασίας — per-job grouping under this customer */}
          <WorkFoldersSection customerId={customerId} />

          {/* Δραστηριότητα — Messenger-style rows that expand */}
          <GroupCard title="Δραστηριότητα">
            <NavRow
              icon="document-text"
              label="Προσφορές"
              count={offers.length}
              open={expanded === 'offers'}
              onPress={() => toggle('offers')}
            />
            {expanded === 'offers' ? (
              offers.length === 0 ? (
                <EmptyLine text="Δεν υπάρχουν προσφορές." />
              ) : (
                offers.map((o) => (
                  <ListRow
                    key={o.id}
                    title={o.offerNumber}
                    subtitle={`${formatDate(o.createdAt)} · ${OFFER_STATUS_GR[o.status] ?? o.status}`}
                    right={formatEuro(o.total)}
                    onPress={() => setPreviewOfferId(o.id)}
                  />
                ))
              )
            ) : null}

            <NavRow
              icon="calendar"
              label="Ραντεβού"
              count={appts.length}
              open={expanded === 'appointments'}
              onPress={() => toggle('appointments')}
            />
            {expanded === 'appointments' ? (
              appts.length === 0 ? (
                <EmptyLine text="Δεν υπάρχουν ραντεβού." />
              ) : (
                appts.map((t) => (
                  <ListRow
                    key={t.id}
                    title={`${t.dueDate.split('-').reverse().join('-')}${t.dueTime ? ` · ${t.dueTime}` : ''}`}
                    subtitle={t.note ?? t.title}
                    onPress={() => setPreviewAppt(t)}
                  />
                ))
              )
            ) : null}

            <NavRow
              icon="images"
              label="Φωτογραφίες & αρχεία"
              count={galleryFiles.length}
              open={expanded === 'files'}
              onPress={() => toggle('files')}
            />
            {expanded === 'files' ? (
              galleryFiles.length === 0 ? (
                <EmptyLine text="Δεν υπάρχουν αρχεία." />
              ) : (
                <View style={styles.grid}>
                  {galleryFiles.slice(0, 24).map((f, i) => {
                    const key = `${f.sessionId}:${f.fileIndex}`;
                    const url = thumbs[key];
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityLabel={f.kind === 'image' ? 'Φωτογραφία' : f.kind === 'video' ? 'Βίντεο' : 'Αρχείο'}
                        onPress={() => openFileTile(i)}
                        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                        {f.kind === 'image' && url ? (
                          <Image source={{ uri: url }} style={styles.tileImg} resizeMode="cover" />
                        ) : (
                          <Ionicons name={f.kind === 'video' ? 'play-circle' : f.kind === 'image' ? 'image' : 'document'} size={26} color={c.textSecondary} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )
            ) : null}

            <NavRow
              icon="mic"
              label="Περιλήψεις κλήσεων"
              count={briefs.length}
              open={expanded === 'calls'}
              onPress={() => toggle('calls')}
            />
            {expanded === 'calls' ? (
              briefs.length === 0 ? (
                <EmptyLine text="Δεν υπάρχουν κλήσεις με περίληψη." />
              ) : (
                briefs.slice(0, 10).map((b) => (
                  <View key={b.id} style={styles.briefRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatDate(b.occurredAt)}
                    </ThemedText>
                    <ThemedText type="small" style={styles.ink}>
                      {b.body}
                    </ThemedText>
                  </View>
                ))
              )
            ) : null}
          </GroupCard>

          {/* Σημείωση */}
          <GroupCard title="Εσωτερική σημείωση">
            <Input value={note} onChangeText={setNote} placeholder="Σημείωση ορατή μόνο σε εσένα…" multiline />
            <PrimaryButton label="Αποθήκευση σημείωσης" onPress={() => void saveNote()} busy={busy} />
          </GroupCard>

          {/* Destructive — like Messenger's Delete chat */}
          <GroupCard>
            <Pressable
              onPress={rejectCustomer}
              disabled={customer.status === 'lost'}
              style={({ pressed }) => [styles.dangerRow, pressed && styles.pressed]}>
              <Ionicons name="trash" size={20} color="#D14343" />
              <ThemedText type="smallBold" style={styles.dangerText}>
                {customer.status === 'lost' ? 'Πελάτης χαμένος' : 'Απόρριψη πελάτη'}
              </ThemedText>
            </Pressable>
          </GroupCard>
        </ScrollView>
      )}

      {/* Edit contact sheet */}
      <SheetModal visible={editOpen} title="Επεξεργασία στοιχείων" onClose={() => setEditOpen(false)}>
        <Input label="Ονοματεπώνυμο" value={form.name ?? ''} onChangeText={set('name')} />
        <Input label="Εταιρεία" value={form.companyName ?? ''} onChangeText={set('companyName')} />
        <Input label="Κινητό" value={form.mobilePhone ?? ''} onChangeText={set('mobilePhone')} keyboardType="phone-pad" />
        <Input label="Σταθερό" value={form.landlinePhone ?? ''} onChangeText={set('landlinePhone')} keyboardType="phone-pad" />
        <Input label="Email" value={form.email ?? ''} onChangeText={set('email')} keyboardType="email-address" />
        <Input label="Διεύθυνση" value={form.address ?? ''} onChangeText={set('address')} />
        <ThemedText type="small" themeColor="textSecondary">
          Προτιμώμενο κανάλι
        </ThemedText>
        <ChipSelect options={CHANNELS} value={form.preferredContactMethod ?? 'phone'} onChange={set('preferredContactMethod')} />
        <ThemedText type="small" themeColor="textSecondary">
          Πηγή
        </ThemedText>
        <ChipSelect options={SOURCES} value={form.source ?? 'other'} onChange={set('source')} />
        <Input label="Ανάγκες πελάτη" value={form.needsSummary ?? ''} onChangeText={set('needsSummary')} multiline />
        <PrimaryButton label="Αποθήκευση" onPress={() => void saveContact()} busy={busy} />
      </SheetModal>

      {/* Offer preview */}
      <OfferPreviewSheet offerId={previewOfferId} onClose={() => setPreviewOfferId(null)} onChanged={() => void load()} />

      {/* Appointment preview */}
      <SheetModal
        visible={!!previewAppt}
        title="Ραντεβού"
        onClose={() => {
          setPreviewAppt(null);
          setApptDraft(null);
        }}>
        {previewAppt ? (
          apptDraft ? (
            <>
              <ThemedText type="smallBold" style={styles.ink}>
                Μήνυμα προς {apptDraft.recipient ?? 'πελάτη'}:
              </ThemedText>
              <View style={styles.msgBox}>
                <ThemedText type="small" style={styles.ink}>
                  {apptDraft.message}
                </ThemedText>
              </View>
              <PrimaryButton label="Αποστολή (Viber → SMS)" busy={busy} onPress={() => void confirmSendApptLink(previewAppt)} />
            </>
          ) : (
            <>
              <ThemedText type="subtitle" style={styles.apptDate}>
                {previewAppt.dueDate.split('-').reverse().join('-')}
                {previewAppt.dueTime ? ` · ${previewAppt.dueTime}` : ''}
              </ThemedText>
              <ThemedText type="small" style={styles.ink}>
                {previewAppt.title}
              </ThemedText>
              {previewAppt.note ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {previewAppt.note}
                </ThemedText>
              ) : null}
              <PrimaryButton label="Αποστολή link ραντεβού" busy={busy} onPress={() => void sendApptLink(previewAppt)} />
            </>
          )
        ) : null}
      </SheetModal>

      {/* Gallery lightbox */}
      <Modal visible={galleryIndex !== null} animationType="fade" onRequestClose={() => setGalleryIndex(null)}>
        <View style={styles.lightbox}>
          <Pressable onPress={() => setGalleryIndex(null)} style={styles.lightboxClose} hitSlop={10}>
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </Pressable>
          {galleryUrl ? (
            <Image source={{ uri: galleryUrl }} style={{ width: win.width, height: win.height * 0.75 }} resizeMode="contain" />
          ) : (
            <ActivityIndicator color="#FFFFFF" />
          )}
          <View style={styles.lightboxNav}>
            <Pressable disabled={!galleryIndex} onPress={() => setGalleryIndex((i) => Math.max(0, (i ?? 0) - 1))} hitSlop={10}>
              <Ionicons name="chevron-back" size={32} color={galleryIndex ? '#FFFFFF' : '#555'} />
            </Pressable>
            <ThemedText style={styles.lightboxCount}>
              {(galleryIndex ?? 0) + 1} / {galleryFiles.length}
            </ThemedText>
            <Pressable
              disabled={(galleryIndex ?? 0) >= galleryFiles.length - 1}
              onPress={() => setGalleryIndex((i) => Math.min(galleryFiles.length - 1, (i ?? 0) + 1))}
              hitSlop={10}>
              <Ionicons name="chevron-forward" size={32} color={(galleryIndex ?? 0) < galleryFiles.length - 1 ? '#FFFFFF' : '#555'} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

// ---------- building blocks ----------

function Quick({
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.quick, disabled && styles.disabled, pressed && styles.pressed]}>
      <View style={styles.quickCircle}>
        <Ionicons name={icon} size={20} color={Brand.primary} />
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.quickLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function GroupCard({ title, children }: { title?: string; children: ReactNode }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.group}>
      {title ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.groupTitle}>
          {title}
        </ThemedText>
      ) : null}
      <View style={styles.groupCard}>{children}</View>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string | null;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={16} color={Brand.primary} />
      </View>
      <View style={styles.infoRowBody}>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
        <ThemedText type="small" style={styles.ink}>
          {value}
        </ThemedText>
      </View>
    </View>
  );
}

function NavRow({
  icon,
  label,
  count,
  open,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count: number;
  open: boolean;
  onPress: () => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.navRow, pressed && styles.pressed]}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={16} color={Brand.primary} />
      </View>
      <ThemedText type="small" style={[styles.ink, styles.navLabel]}>
        {label}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {count}
      </ThemedText>
      <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={16} color={c.textSecondary} />
    </Pressable>
  );
}

function EmptyLine({ text }: { text: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
      {text}
    </ThemedText>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ink: { color: c.text },
  headerSafe: { backgroundColor: c.background },
  back: { paddingHorizontal: Spacing.two, paddingVertical: 4, alignSelf: 'flex-start' },
  content: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.six, gap: Spacing.three },

  hero: { alignItems: 'center', gap: 6, paddingTop: Spacing.two },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Brand.primary, fontSize: 40, lineHeight: 48, fontWeight: '700' },
  name: { fontSize: 26, lineHeight: 32, textAlign: 'center' },
  badge: { backgroundColor: Brand.primarySoft, paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: Brand.primary, fontSize: 13, fontWeight: '700' },
  quickRow: { flexDirection: 'row', gap: Spacing.four, marginTop: Spacing.three },
  quick: { alignItems: 'center', gap: 4, width: 64 },
  quickLabel: { fontSize: 12, textAlign: 'center' },
  quickCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' },

  group: { gap: 6 },
  groupTitle: { paddingHorizontal: 4, fontWeight: '700' },
  groupCard: { backgroundColor: c.surface, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  infoRowBody: { flex: 1, gap: 1 },
  emptyRow: { paddingVertical: 4 },

  navRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 6 },
  navLabel: { flex: 1, fontWeight: '600' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: '23%', aspectRatio: 1, borderRadius: 10, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileImg: { width: '100%', height: '100%' },

  briefRow: { backgroundColor: c.card, borderLeftWidth: 3, borderLeftColor: Brand.primarySoft, borderRadius: 10, padding: Spacing.three, gap: 4 },

  dangerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  dangerText: { color: '#D14343' },

  msgBox: { backgroundColor: c.surface, borderRadius: 14, padding: Spacing.three },
  apptDate: { fontSize: 22, lineHeight: 28, color: c.text },

  lightbox: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  lightboxClose: { position: 'absolute', top: 56, right: 20, zIndex: 2 },
  lightboxNav: { position: 'absolute', bottom: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.five },
  lightboxCount: { color: '#FFFFFF', fontSize: 14 },

  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
