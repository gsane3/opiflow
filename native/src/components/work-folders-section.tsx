// «Έργα» (Projects) section — native port of the web CustomerFoldersStrip, 1:1:
// «Έργα» header with a + button, rich project cards (status dot + pill + 5-segment
// mini-stepper + counts/date foot), the «Νέο έργο» sheet (title + template chips +
// SMS-link note + «Δημιουργία & αποστολή link»), and — on tap — the full-screen
// chat-first «Διαδικασία» (ProjectProcess). Wired to the live folder APIs.

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { ProjectProcess, type ProjectInitial } from '@/components/project-process';
import { ThemedText } from '@/components/themed-text';
import { Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { WorkFolder, WorkFolderCounts } from '@/lib/types';

const STATUS_LABEL: Record<string, string> = { open: 'Νέο', in_progress: 'Σε εξέλιξη', done: 'Ολοκληρώθηκε', archived: 'Αρχειοθ.' };
const C_SUCCESS = '#18A06A';
const C_WARN = '#E0922F';
const DOT_COLOR: Record<string, string> = { open: Brand.primary, in_progress: C_WARN, done: C_SUCCESS, archived: '#9AA6B2' };
const STATUS_RANK = (s: string) => (s === 'in_progress' ? 0 : s === 'open' ? 1 : s === 'done' ? 2 : 3);
const TEMPLATES = ['Τοποθέτηση A/C', 'Επισκευή', 'Συντήρηση', 'Νέα εγκατάσταση'];

function countsLine(c?: WorkFolderCounts): string {
  if (!c) return '';
  const parts: string[] = [];
  if (c.offers) parts.push(`${c.offers} προσφ.`);
  if (c.appointments) parts.push(`${c.appointments} ραντ.`);
  if (c.uploadRequests) parts.push(`${c.uploadRequests} φωτό`);
  if (c.messages) parts.push(`${c.messages} μην.`);
  return parts.join(' · ');
}

export function WorkFoldersSection({ customerId, openCreateSignal, openLatestSignal }: { customerId: string; openCreateSignal?: number; openLatestSignal?: number }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [folders, setFolders] = useState<WorkFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<ProjectInitial | null>(null);

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');

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

  useEffect(() => { void load(); }, [load]);

  // Hero «Νέο έργο» action (profile) opens the create sheet via a bumped signal.
  useEffect(() => {
    if (openCreateSignal && openCreateSignal > 0) { setTitle(''); setCreateErr(''); setCreating(true); }
  }, [openCreateSignal]);

  async function createFolder() {
    const t = title.trim();
    if (!t) { setCreateErr('Γράψε τίτλο έργου.'); return; }
    if (t.length > 120) { setCreateErr('Έως 120 χαρακτήρες.'); return; }
    setCreateErr(''); setCreateBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean; folder?: WorkFolder }>(`/api/customers/${customerId}/folders`, { title: t });
      if (r?.ok) {
        setCreating(false); setTitle('');
        await load();
        if (r.folder?.id) setOpen({ id: r.folder.id, title: r.folder.title ?? t, status: r.folder.status ?? 'open', step: r.folder.step ?? 0 });
      } else setCreateErr('Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } catch (e) {
      setCreateErr(e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } finally {
      setCreateBusy(false);
    }
  }

  function openCreate() { setTitle(''); setCreateErr(''); setCreating(true); }

  const list = useMemo(() => [...folders].sort((a, b) => STATUS_RANK(a.status) - STATUS_RANK(b.status)), [folders]);

  // Profile «Μήνυμα» action: open the most-relevant project (active first) — that's
  // where the chat lives — or the create sheet if the customer has no project yet
  // (the project-first gate). Deferred until folders load so an early tap can't
  // wrongly open «Νέο έργο» for a customer who actually has projects.
  const [pendingLatest, setPendingLatest] = useState(false);
  useEffect(() => {
    if (openLatestSignal && openLatestSignal > 0) setPendingLatest(true);
  }, [openLatestSignal]);
  useEffect(() => {
    if (!pendingLatest || loading) return;
    setPendingLatest(false);
    if (list.length > 0) {
      const p = list[0];
      setOpen({ id: p.id, title: p.title, status: p.status, step: p.step ?? 0 });
    } else {
      openCreate();
    }
  }, [pendingLatest, loading, list]);

  return (
    <View style={styles.group}>
      <View style={styles.header}>
        <View style={styles.headerL}>
          <Ionicons name="folder-outline" size={18} color={Brand.primary} />
          <ThemedText type="small" themeColor="textSecondary" style={styles.headerTitle}>Έργα</ThemedText>
        </View>
        <Pressable onPress={openCreate} hitSlop={8} style={({ pressed }) => [styles.addBtn, pressed && styles.dim]} accessibilityLabel="Νέο έργο">
          <Ionicons name="add" size={20} color={Brand.primary} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.card}><View style={styles.center}><ActivityIndicator color={Brand.primary} /></View></View>
      ) : error ? (
        <View style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>Δεν φορτώθηκαν τα έργα.</ThemedText>
          <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={() => void load()} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.card}>
          <View style={styles.gateRow}>
            <View style={styles.gateNum}><ThemedText style={styles.gateNumText}>1</ThemedText></View>
            <View style={{ flex: 1 }}>
              <ThemedText type="smallBold" style={styles.ink}>Δημιούργησε έργο</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">Απαραίτητο πριν στείλεις προσφορά, ραντεβού ή μήνυμα. Δημιουργεί link που στέλνεται στον πελάτη.</ThemedText>
            </View>
          </View>
          <PrimaryButton label="Δημιουργία έργου" onPress={openCreate} />
        </View>
      ) : (
        <View style={styles.list}>
          {list.map((p) => {
            const cl = countsLine(p.counts);
            const step = p.step ?? 0;
            return (
              <Pressable
                key={p.id}
                onPress={() => setOpen({ id: p.id, title: p.title, status: p.status, step })}
                style={({ pressed }) => [styles.projCard, pressed && styles.dim]}>
                <View style={styles.projTop}>
                  <View style={[styles.dot, { backgroundColor: DOT_COLOR[p.status] ?? Brand.primary }]} />
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.projTitle}>{p.title}</ThemedText>
                  <View style={[styles.pill, p.status === 'done' ? styles.pillOk : styles.pillWarn]}>
                    <ThemedText style={[styles.pillText, p.status === 'done' ? styles.pillTextOk : styles.pillTextWarn]}>{STATUS_LABEL[p.status] ?? p.status}</ThemedText>
                  </View>
                </View>
                <View style={styles.miniBar}>
                  {[0, 1, 2, 3, 4].map((i) => <View key={i} style={[styles.seg, i <= step && styles.segOn]} />)}
                </View>
                <View style={styles.projFoot}>
                  <Ionicons name="link-outline" size={13} color={c.textFaint} />
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{(cl || 'Άνοιγμα έργου') + ' · ' + formatDate(p.updatedAt)}</ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Νέο έργο sheet */}
      <SheetModal visible={creating} title="Νέο έργο" onClose={() => setCreating(false)}>
        {createErr ? <ThemedText type="small" style={styles.err}>{createErr}</ThemedText> : null}
        <Input label="Τίτλος έργου" value={title} onChangeText={(v) => { setTitle(v); if (createErr) setCreateErr(''); }} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
        <View style={styles.tplRow}>
          {TEMPLATES.map((x) => (
            <Pressable key={x} onPress={() => setTitle(x)} style={({ pressed }) => [styles.tplChip, pressed && styles.dim]}>
              <ThemedText type="small" style={styles.tplText}>{x}</ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={styles.linkNote}>
          <Ionicons name="link-outline" size={16} color={Brand.primary} />
          <ThemedText type="small" style={[styles.ink, { flex: 1 }]}>Δημιουργείται link που στέλνεται με SMS — ο πελάτης βλέπει εκεί προσφορές, ραντεβού και συνομιλία.</ThemedText>
        </View>
        <PrimaryButton label={createBusy ? 'Δημιουργία…' : 'Δημιουργία & αποστολή link'} busy={createBusy} onPress={() => void createFolder()} />
      </SheetModal>

      {/* Full-screen «Διαδικασία» */}
      {open ? (
        <ProjectProcess
          visible
          folderId={open.id}
          customerId={customerId}
          initial={open}
          onClose={() => setOpen(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  group: { gap: 6 },
  ink: { color: c.text },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  headerL: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerTitle: { fontWeight: '700' },
  addBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.primarySoft },

  card: { backgroundColor: c.surface, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.three },
  emptyRow: { paddingVertical: 4 },

  gateRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  gateNum: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Brand.primary },
  gateNumText: { color: '#fff', fontWeight: '800', fontSize: 14 },

  list: { gap: 11 },
  projCard: { backgroundColor: c.surface, borderRadius: 16, padding: Spacing.three, gap: 10, borderWidth: 1, borderColor: c.borderFaint },
  projTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  projTitle: { flex: 1, color: c.text, fontSize: 16 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  pillOk: { backgroundColor: `${C_SUCCESS}22` },
  pillWarn: { backgroundColor: `${C_WARN}22` },
  pillText: { fontSize: 11, fontWeight: '800' },
  pillTextOk: { color: C_SUCCESS },
  pillTextWarn: { color: C_WARN },
  miniBar: { flexDirection: 'row', gap: 5 },
  seg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: c.surface === '#FFFFFF' ? '#E8EEF4' : c.border },
  segOn: { backgroundColor: Brand.primary },
  projFoot: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // new-project sheet
  err: { color: '#D14343' },
  tplRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tplChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  tplText: { color: c.textSecondary, fontWeight: '600' },
  linkNote: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', backgroundColor: Brand.primarySoft, borderRadius: 14, padding: 13, marginTop: 12, marginBottom: 4 },

  dim: { opacity: 0.6 },
});
