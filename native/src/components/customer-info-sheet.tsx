// Customer info panel — 1:1 with the web CustomerInfoPanel:
// Στοιχεία επικοινωνίας (edit) → Maps → Προσφορές → Ραντεβού → Αρχεία (gallery)
// → Κλήσεις (AI briefs) → Εσωτερική σημείωση → Απόρριψη πελάτη.

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { OfferPreviewSheet } from '@/components/offer-preview-sheet';
import { ChipSelect, Input, ListRow, PrimaryButton, Section, SheetModal } from '@/components/ui';
import { Brand, Spacing } from '@/constants/theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatDate, formatEuro } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Customer, GalleryFile, LinkDraft, Offer, Task, TimelineItem, UploadSession } from '@/lib/types';

const APPT_TYPES = new Set(['book_appointment', 'visit_customer']);

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

export function CustomerInfoSheet({
  customerId,
  visible,
  onClose,
  onChanged,
  timelineItems,
}: {
  customerId: string;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
  /** Timeline call items (for the Κλήσεις briefs section). */
  timelineItems: TimelineItem[];
}) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [appts, setAppts] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<UploadSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // contact form
  const [form, setForm] = useState<Record<string, string>>({});
  // note
  const [note, setNote] = useState('');
  // sheets
  const [previewOfferId, setPreviewOfferId] = useState<string | null>(null);
  const [previewAppt, setPreviewAppt] = useState<Task | null>(null);
  const [apptDraft, setApptDraft] = useState<LinkDraft | null>(null);
  // gallery
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [galleryUrl, setGalleryUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, oRes, tRes, sRes] = await Promise.all([
        apiGet<{ ok?: boolean; customer?: Customer }>(`/api/customers/${customerId}`),
        apiGet<{ ok?: boolean; offers?: Offer[] }>(`/api/offers?customerId=${customerId}&limit=50`),
        apiGet<{ ok?: boolean; tasks?: Task[] }>(`/api/tasks?customerId=${customerId}&limit=100`),
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
      if (!sRes.error && Array.isArray(sRes.data)) setSessions(sRes.data as unknown as UploadSession[]);
    } catch {
      // pull-down of the sheet retries via reopen
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (visible) {
      setThumbs({});
      setGalleryIndex(null);
      void load();
    }
  }, [visible, load]);

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

  // Resolve image thumbnails lazily (first 24).
  useEffect(() => {
    if (!visible || galleryFiles.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const f of galleryFiles.slice(0, 24)) {
        if (f.kind !== 'image') continue;
        const key = `${f.sessionId}:${f.fileIndex}`;
        if (thumbs[key]) continue;
        const url = await resolveUrl(f);
        if (cancelled) return;
        if (url) setThumbs((t) => ({ ...t, [key]: url }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, galleryFiles, resolveUrl]);

  // Resolve the full-size URL when the lightbox opens / pages.
  useEffect(() => {
    if (galleryIndex === null) {
      setGalleryUrl(null);
      return;
    }
    const f = galleryFiles[galleryIndex];
    if (!f) return;
    setGalleryUrl(null);
    void resolveUrl(f).then((u) => setGalleryUrl(u));
  }, [galleryIndex, galleryFiles, resolveUrl]);

  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

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
        onChanged();
        Alert.alert('✓', 'Αποθηκεύτηκε.');
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
      onChanged();
      Alert.alert('✓', 'Η σημείωση αποθηκεύτηκε.');
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  function rejectCustomer() {
    if (customer?.status === 'lost') return;
    Alert.alert('Απόρριψη πελάτη', 'Ο πελάτης θα σημανθεί ως «Χαμένος». Συνέχεια;', [
      { text: 'Ακύρωση', style: 'cancel' },
      {
        text: 'Απόρριψη',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiPatch(`/api/customers/${customerId}`, { status: 'lost' });
            onChanged();
            void load();
          } catch {
            Alert.alert('Σφάλμα', 'Απέτυχε.');
          }
        },
      },
    ]);
  }

  async function sendApptLink(t: Task) {
    setBusy(true);
    try {
      const d = await apiPost<LinkDraft>(`/api/customers/${customerId}/appointment-link`, {
        taskId: t.id,
        mode: 'draft',
      });
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

  const callBriefs = timelineItems.filter((it) => it.type === 'call' && it.body);
  const win = Dimensions.get('window');

  return (
    <>
      <SheetModal visible={visible} title="Πληροφορίες πελάτη" onClose={onClose}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Brand.primary} />
          </View>
        ) : (
          <>
            {/* Στοιχεία επικοινωνίας */}
            <Section title="Στοιχεία επικοινωνίας" initiallyOpen>
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
            </Section>

            {/* Maps */}
            {form.address ? (
              <Pressable
                onPress={() =>
                  Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.address)}`)
                }
                style={({ pressed }) => [styles.mapsBtn, pressed && styles.pressed]}>
                <Ionicons name="map" size={18} color={Brand.primary} />
                <View style={styles.mapsText}>
                  <ThemedText type="smallBold" style={{ color: Brand.primary }}>
                    Άνοιγμα στο Google Maps
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {form.address}
                  </ThemedText>
                </View>
              </Pressable>
            ) : null}

            {/* Προσφορές */}
            <Section title="Προσφορές" count={offers.length}>
              {offers.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Δεν υπάρχουν προσφορές.
                </ThemedText>
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
              )}
            </Section>

            {/* Ραντεβού */}
            <Section title="Ραντεβού" count={appts.length}>
              {appts.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Δεν υπάρχουν ραντεβού.
                </ThemedText>
              ) : (
                appts.map((t) => (
                  <ListRow
                    key={t.id}
                    title={`${t.dueDate.split('-').reverse().join('-')}${t.dueTime ? ` · ${t.dueTime}` : ''}`}
                    subtitle={t.note ?? t.title}
                    onPress={() => setPreviewAppt(t)}
                  />
                ))
              )}
            </Section>

            {/* Αρχεία */}
            <Section title="Αρχεία" count={galleryFiles.length}>
              {galleryFiles.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Δεν υπάρχουν αρχεία.
                </ThemedText>
              ) : (
                <View style={styles.grid}>
                  {galleryFiles.slice(0, 24).map((f, i) => {
                    const key = `${f.sessionId}:${f.fileIndex}`;
                    const url = thumbs[key];
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setGalleryIndex(i)}
                        style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                        {f.kind === 'image' && url ? (
                          <Image source={{ uri: url }} style={styles.tileImg} resizeMode="cover" />
                        ) : (
                          <Ionicons
                            name={f.kind === 'video' ? 'play-circle' : f.kind === 'image' ? 'image' : 'document'}
                            size={26}
                            color="#9AA4B2"
                          />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </Section>

            {/* Κλήσεις (AI briefs) */}
            <Section title="Κλήσεις" count={callBriefs.length}>
              {callBriefs.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Δεν υπάρχουν κλήσεις με περίληψη.
                </ThemedText>
              ) : (
                callBriefs.slice(0, 10).map((b) => (
                  <View key={b.id} style={styles.briefRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatDate(b.occurredAt)}
                    </ThemedText>
                    <ThemedText type="small" style={styles.dark}>
                      {b.body}
                    </ThemedText>
                  </View>
                ))
              )}
            </Section>

            {/* Εσωτερική σημείωση */}
            <Section title="Εσωτερική σημείωση" initiallyOpen={false}>
              <Input value={note} onChangeText={setNote} placeholder="Σημείωση ορατή μόνο σε εσένα…" multiline />
              <PrimaryButton label="Αποθήκευση σημείωσης" onPress={() => void saveNote()} busy={busy} />
            </Section>

            {/* Απόρριψη */}
            <PrimaryButton
              label={customer?.status === 'lost' ? 'Πελάτης χαμένος' : 'Απόρριψη πελάτη'}
              tone="danger"
              disabled={customer?.status === 'lost'}
              onPress={rejectCustomer}
            />
          </>
        )}
      </SheetModal>

      {/* Offer preview */}
      <OfferPreviewSheet
        offerId={previewOfferId}
        onClose={() => setPreviewOfferId(null)}
        onChanged={() => {
          void load();
          onChanged();
        }}
      />

      {/* Appointment preview */}
      <SheetModal visible={!!previewAppt} title="Ραντεβού" onClose={() => { setPreviewAppt(null); setApptDraft(null); }}>
        {previewAppt ? (
          apptDraft ? (
            <>
              <ThemedText type="smallBold">Μήνυμα προς {apptDraft.recipient ?? 'πελάτη'}:</ThemedText>
              <View style={styles.msgBox}>
                <ThemedText type="small" style={styles.dark}>
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
              <ThemedText type="small" style={styles.dark}>
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
            <Pressable
              disabled={!galleryIndex}
              onPress={() => setGalleryIndex((i) => Math.max(0, (i ?? 0) - 1))}
              hitSlop={10}>
              <Ionicons name="chevron-back" size={32} color={galleryIndex ? '#FFFFFF' : '#555'} />
            </Pressable>
            <ThemedText style={styles.lightboxCount}>
              {(galleryIndex ?? 0) + 1} / {galleryFiles.length}
            </ThemedText>
            <Pressable
              disabled={(galleryIndex ?? 0) >= galleryFiles.length - 1}
              onPress={() => setGalleryIndex((i) => Math.min(galleryFiles.length - 1, (i ?? 0) + 1))}
              hitSlop={10}>
              <Ionicons
                name="chevron-forward"
                size={32}
                color={(galleryIndex ?? 0) < galleryFiles.length - 1 ? '#FFFFFF' : '#555'}
              />
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: Spacing.six, alignItems: 'center' },
  mapsBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: '#F7F9FB', borderRadius: 14, padding: Spacing.three },
  mapsText: { flex: 1, gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: { width: '23%', aspectRatio: 1, borderRadius: 10, backgroundColor: '#EDF1F5', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tileImg: { width: '100%', height: '100%' },
  briefRow: { backgroundColor: '#FFFFFF', borderLeftWidth: 3, borderLeftColor: Brand.primarySoft, borderRadius: 10, padding: Spacing.three, gap: 4 },
  msgBox: { backgroundColor: '#F7F9FB', borderRadius: 14, padding: Spacing.three },
  apptDate: { fontSize: 22, lineHeight: 28, color: '#0A1120' },
  dark: { color: '#0A1120' },
  lightbox: { flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' },
  lightboxClose: { position: 'absolute', top: 56, right: 20, zIndex: 2 },
  lightboxNav: { position: 'absolute', bottom: 48, flexDirection: 'row', alignItems: 'center', gap: Spacing.five },
  lightboxCount: { color: '#FFFFFF', fontSize: 14 },
  pressed: { opacity: 0.7 },
});
