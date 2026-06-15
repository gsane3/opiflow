// «Φάκελοι εργασίας» — per-job grouping under a customer (WF-1B, native).
// Self-contained: lists the customer's folders, creates one, and opens a minimal
// detail/edit sheet. Uses the WF-1A authenticated APIs. No public link / token /
// attach picker here — those are later phases.

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipSelect, Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { WorkFolder, WorkFolderCounts } from '@/lib/types';

const STATUS_LABELS: Record<string, string> = {
  open: 'Νέο',
  in_progress: 'Σε εξέλιξη',
  done: 'Ολοκληρώθηκε',
  archived: 'Αρχειοθετήθηκε',
};

const STATUS_OPTIONS = [
  { key: 'open', label: 'Νέο' },
  { key: 'in_progress', label: 'Σε εξέλιξη' },
  { key: 'done', label: 'Ολοκληρώθηκε' },
  { key: 'archived', label: 'Αρχειοθετήθηκε' },
];

/** Short «2 προσφορές · 1 ραντεβού» summary from the API counts (non-zero only). */
function countsSummary(counts?: WorkFolderCounts): string {
  if (!counts) return '';
  const parts: string[] = [];
  if (counts.offers) parts.push(`${counts.offers} προσφορές`);
  if (counts.appointments) parts.push(`${counts.appointments} ραντεβού`);
  if (counts.messages) parts.push(`${counts.messages} μηνύματα`);
  if (counts.uploadRequests) parts.push(`${counts.uploadRequests} φωτογραφίες`);
  return parts.join(' · ');
}

export function WorkFoldersSection({ customerId }: { customerId: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [folders, setFolders] = useState<WorkFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // create sheet
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('open');
  const [titleError, setTitleError] = useState('');
  const [saving, setSaving] = useState(false);

  // detail/edit sheet
  const [detail, setDetail] = useState<WorkFolder | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eNotes, setENotes] = useState('');
  const [eStatus, setEStatus] = useState('open');
  const [eBusy, setEBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ ok?: boolean; folders?: WorkFolder[] }>(`/api/customers/${customerId}/folders`);
      setFolders(r?.folders ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setTitle('');
    setNotes('');
    setStatus('open');
    setTitleError('');
    setCreateOpen(true);
  }

  async function createFolder() {
    const t = title.trim();
    if (!t) {
      setTitleError('Γράψε τίτλο εργασίας.');
      return;
    }
    setSaving(true);
    try {
      const r = await apiPost<{ ok?: boolean; folder?: WorkFolder }>(`/api/customers/${customerId}/folders`, {
        title: t,
        notes: notes.trim() || null,
        status,
      });
      if (r?.ok) {
        setCreateOpen(false);
        Alert.alert('✓', 'Ο φάκελος δημιουργήθηκε');
        void load();
      } else {
        Alert.alert('Σφάλμα', 'Ο φάκελος δεν δημιουργήθηκε.');
      }
    } catch {
      Alert.alert('Σφάλμα', 'Ο φάκελος δεν δημιουργήθηκε.');
    } finally {
      setSaving(false);
    }
  }

  function openDetail(f: WorkFolder) {
    setDetail(f);
    setEditMode(false);
    setETitle(f.title);
    setENotes(f.notes ?? '');
    setEStatus(f.status);
  }

  function closeDetail() {
    setDetail(null);
    setEditMode(false);
  }

  async function patchFolder(updates: Record<string, unknown>): Promise<boolean> {
    if (!detail) return false;
    setEBusy(true);
    try {
      const r = await apiPatch<{ ok?: boolean; folder?: WorkFolder }>(`/api/folders/${detail.id}`, updates);
      if (r?.ok && r.folder) {
        setDetail(r.folder);
        void load();
        return true;
      }
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
      return false;
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
      return false;
    } finally {
      setEBusy(false);
    }
  }

  async function saveEdit() {
    const t = eTitle.trim();
    if (!t) {
      Alert.alert('Σφάλμα', 'Γράψε τίτλο εργασίας.');
      return;
    }
    const ok = await patchFolder({ title: t, notes: eNotes.trim() || null, status: eStatus });
    if (ok) setEditMode(false);
  }

  async function archive() {
    const ok = await patchFolder({ status: 'archived' });
    if (ok) setEStatus('archived');
  }

  return (
    <View style={styles.group}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.groupTitle}>
        Φάκελοι εργασίας
      </ThemedText>
      <View style={styles.card}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Brand.primary} />
            <ThemedText type="small" themeColor="textSecondary">
              Φορτώνουν οι φάκελοι...
            </ThemedText>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <ThemedText type="small" themeColor="textSecondary">
              Δεν φορτώθηκαν οι φάκελοι.
            </ThemedText>
            <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={() => void load()} />
          </View>
        ) : folders.length === 0 ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
              Δεν υπάρχει φάκελος ακόμα.
            </ThemedText>
            <PrimaryButton label="Νέος φάκελος" onPress={openCreate} />
          </>
        ) : (
          <>
            {folders.map((f) => {
              const summary = countsSummary(f.counts);
              return (
                <Pressable
                  key={f.id}
                  onPress={() => openDetail(f)}
                  style={({ pressed }) => [styles.folderRow, pressed && styles.pressed]}>
                  <View style={styles.folderBody}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.ink}>
                      {f.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {STATUS_LABELS[f.status] ?? f.status}
                      {f.updatedAt ? ` · ${formatDate(f.updatedAt)}` : ''}
                    </ThemedText>
                    {summary ? (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {summary}
                      </ThemedText>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </Pressable>
              );
            })}
            <PrimaryButton label="Νέος φάκελος" tone="outline" onPress={openCreate} />
          </>
        )}
      </View>

      {/* Create sheet */}
      <SheetModal visible={createOpen} title="Νέος φάκελος" onClose={() => setCreateOpen(false)}>
        <Input
          label="Τίτλος εργασίας"
          value={title}
          onChangeText={(v) => {
            setTitle(v);
            if (titleError) setTitleError('');
          }}
          placeholder="π.χ. Τοποθέτηση κλιματιστικού"
        />
        {titleError ? (
          <ThemedText type="small" style={styles.err}>
            {titleError}
          </ThemedText>
        ) : null}
        <Input label="Σημειώσεις" value={notes} onChangeText={setNotes} placeholder="προαιρετικά" multiline />
        <ThemedText type="small" themeColor="textSecondary">
          Κατάσταση
        </ThemedText>
        <ChipSelect options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <PrimaryButton label="Δημιουργία φακέλου" busy={saving} onPress={() => void createFolder()} />
      </SheetModal>

      {/* Detail / edit sheet */}
      <SheetModal visible={!!detail} title={detail?.title ?? 'Φάκελος'} onClose={closeDetail}>
        {detail ? (
          editMode ? (
            <>
              <Input label="Τίτλος εργασίας" value={eTitle} onChangeText={setETitle} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
              <Input label="Σημειώσεις" value={eNotes} onChangeText={setENotes} placeholder="προαιρετικά" multiline />
              <ThemedText type="small" themeColor="textSecondary">
                Κατάσταση
              </ThemedText>
              <ChipSelect options={STATUS_OPTIONS} value={eStatus} onChange={setEStatus} />
              <PrimaryButton label="Αποθήκευση" busy={eBusy} onPress={() => void saveEdit()} />
              <PrimaryButton label="Πίσω" tone="outline" onPress={() => setEditMode(false)} />
            </>
          ) : (
            <>
              <View style={styles.detailBadge}>
                <ThemedText style={styles.detailBadgeText}>{STATUS_LABELS[detail.status] ?? detail.status}</ThemedText>
              </View>
              {detail.notes ? (
                <ThemedText type="small" style={styles.ink}>
                  {detail.notes}
                </ThemedText>
              ) : null}
              {countsSummary(detail.counts) ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {countsSummary(detail.counts)}
                </ThemedText>
              ) : null}
              <View style={styles.placeholderBox}>
                <ThemedText type="small" themeColor="textSecondary">
                  Οι προσφορές, τα ραντεβού και οι φωτογραφίες θα εμφανίζονται εδώ.
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Σύντομα θα μπορείς να συνδέεις προσφορές και ραντεβού εδώ.
                </ThemedText>
              </View>
              <PrimaryButton
                label="Επεξεργασία"
                tone="outline"
                onPress={() => {
                  setETitle(detail.title);
                  setENotes(detail.notes ?? '');
                  setEStatus(detail.status);
                  setEditMode(true);
                }}
              />
              {detail.status !== 'archived' ? (
                <PrimaryButton label="Αρχειοθέτηση" tone="outline" busy={eBusy} onPress={() => void archive()} />
              ) : null}
            </>
          )
        ) : null}
      </SheetModal>
    </View>
  );
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    group: { gap: 6 },
    groupTitle: { paddingHorizontal: 4, fontWeight: '700' },
    card: { backgroundColor: c.surface, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
    center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
    ink: { color: c.text },
    emptyRow: { paddingVertical: 4 },
    folderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: c.card, borderRadius: 12, padding: Spacing.three },
    folderBody: { flex: 1, gap: 2 },
    err: { color: '#D14343' },
    detailBadge: { alignSelf: 'flex-start', backgroundColor: Brand.primarySoft, paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999 },
    detailBadgeText: { color: Brand.primary, fontSize: 13, fontWeight: '700' },
    placeholderBox: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three, gap: 4 },
    pressed: { opacity: 0.7 },
  });
