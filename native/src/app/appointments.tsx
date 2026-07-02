// Ραντεβού — native agenda mirroring the web appointments page. Lists open
// book_appointment / visit_customer tasks grouped by date (Εκπρόθεσμα / Σήμερα /
// Αύριο / dd-mm-yyyy), ascending. Tap a row → open its customer. Per-appointment
// "Αποστολή link" action drafts the Viber appointment-response message in a
// SheetModal, then sends it.
//
// Deferred: the web page also lets the professional accept/reject a customer's
// time-change request (parsing the task note for "Πρόταση αλλαγής από πελάτη"
// and PATCHing dueDate/dueTime). Those response flows are intentionally NOT
// ported here yet — this screen surfaces the agenda + send-link only.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppointmentsCalendar } from '@/components/appointments-calendar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton, SheetModal } from '@/components/ui';
import { BottomTabInset, Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPost } from '@/lib/api';
import { greekUpper, todayYMD } from '@/lib/format';
import type { Customer, LinkDraft, Task } from '@/lib/types';

const APPT_TYPES = ['book_appointment', 'visit_customer'] as const;

const TYPE_LABEL: Record<string, string> = {
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη πελάτη',
};

// A list is either a date-group header (string) or an appointment row (Task).
type Row = { kind: 'header'; key: string; label: string; overdue: boolean } | { kind: 'item'; task: Task };

function ymdToDmy(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}-${m}-${y}` : ymd;
}

export default function AppointmentsScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const [appts, setAppts] = useState<Task[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Send-link sheet state.
  const [linkTask, setLinkTask] = useState<Task | null>(null);
  const [draft, setDraft] = useState<LinkDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // List vs Google-style calendar/day view (persisted, parity with web).
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  useEffect(() => {
    AsyncStorage.getItem('opiflow:appt-view')
      .then((v) => { if (v === 'calendar' || v === 'list') setViewMode(v); })
      .catch(() => {});
  }, []);
  const changeViewMode = (m: 'list' | 'calendar') => {
    setViewMode(m);
    AsyncStorage.setItem('opiflow:appt-view', m).catch(() => {});
  };

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=open&limit=200'),
        apiGet<{ customers?: Customer[] }>('/api/customers?limit=100'),
      ]);
      const list = (t?.tasks ?? [])
        .filter((task) => (APPT_TYPES as readonly string[]).includes(task.type))
        .sort((a, b) =>
          a.dueDate !== b.dueDate
            ? a.dueDate.localeCompare(b.dueDate)
            : (a.dueTime ?? 'zz').localeCompare(b.dueTime ?? 'zz'),
        );
      setAppts(list);
      const map: Record<string, string> = {};
      for (const cu of c?.customers ?? []) map[cu.id] = cu.name ?? 'Πελάτης';
      setNames(map);
    } catch {
      // keep last; pull-to-refresh retries
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = todayYMD();
  const tomorrow = useMemo(() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [today]);

  // Flatten the ascending list into [header, ...items, header, ...items] rows.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastKey: string | null = null;
    for (const task of appts) {
      const overdue = task.dueDate < today;
      // Past-due items collapse under one "Εκπρόθεσμα" header.
      const key = overdue ? 'overdue' : task.dueDate;
      if (key !== lastKey) {
        const label =
          key === 'overdue'
            ? 'Εκπρόθεσμα'
            : task.dueDate === today
              ? 'Σήμερα'
              : task.dueDate === tomorrow
                ? 'Αύριο'
                : ymdToDmy(task.dueDate);
        out.push({ kind: 'header', key, label, overdue });
        lastKey = key;
      }
      out.push({ kind: 'item', task });
    }
    return out;
  }, [appts, today, tomorrow]);

  function openLink(task: Task) {
    setLinkTask(task);
    setDraft(null);
    setLinkError(null);
    setSent(false);
  }

  function closeLink() {
    setLinkTask(null);
    setDraft(null);
    setLinkError(null);
    setSent(false);
    setDrafting(false);
    setSending(false);
  }

  async function buildDraft() {
    if (!linkTask?.customerId) return;
    setDrafting(true);
    setLinkError(null);
    try {
      const d = await apiPost<LinkDraft>(`/api/customers/${linkTask.customerId}/appointment-link`, {
        taskId: linkTask.id,
        mode: 'draft',
      });
      if (d?.message) setDraft(d);
      else setLinkError(d?.error ?? 'Δεν δημιουργήθηκε μήνυμα (λείπει τηλέφωνο;).');
    } catch {
      setLinkError('Δεν δημιουργήθηκε το μήνυμα. Δοκίμασε ξανά.');
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!linkTask?.customerId) return;
    setSending(true);
    setLinkError(null);
    try {
      const r = await apiPost<LinkDraft>(`/api/customers/${linkTask.customerId}/appointment-link`, {
        taskId: linkTask.id,
        mode: 'send',
        channel: 'viber',
      });
      if (r?.sent) setSent(true);
      else setLinkError(`Δεν στάλθηκε${r?.fallbackReason ? ` (${r.fallbackReason})` : ''}.`);
    } catch {
      setLinkError('Η αποστολή απέτυχε. Δοκίμασε ξανά.');
    } finally {
      setSending(false);
    }
  }

  const linkCustomerName = linkTask?.customerId ? names[linkTask.customerId] : undefined;

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={28} color={Brand.primary} />
          </Pressable>
          <ThemedText type="subtitle" style={styles.title}>
            Ραντεβού
          </ThemedText>
        </View>
      </SafeAreaView>

      {/* List ↔ Calendar toggle */}
      <View style={styles.toggle}>
        {(['list', 'calendar'] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => changeViewMode(m)}
            style={[styles.toggleBtn, viewMode === m && styles.toggleBtnActive]}>
            <ThemedText type="smallBold" style={viewMode === m ? styles.toggleTextActive : styles.toggleText}>
              {m === 'list' ? 'Λίστα' : 'Ημερολόγιο'}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Brand.primary} />
        </View>
      ) : viewMode === 'calendar' ? (
        <AppointmentsCalendar
          appointments={appts}
          names={names}
          onSelect={(t) => t.customerId && router.push({ pathname: '/customers/[id]', params: { id: t.customerId } })}
        />
      ) : rows.length === 0 ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">Δεν υπάρχουν ραντεβού.</ThemedText>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => (r.kind === 'header' ? `h:${r.key}` : `t:${r.task.id}`)}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={Brand.primary}
            />
          }
          renderItem={({ item }) => {
            if (item.kind === 'header') {
              return (
                <ThemedText
                  type="smallBold"
                  style={[styles.groupHeader, item.overdue && styles.groupHeaderOverdue]}>
                  {greekUpper(item.label)}
                </ThemedText>
              );
            }
            const task = item.task;
            const customerName = task.customerId ? names[task.customerId] : undefined;
            return (
              <View style={styles.row}>
                <Pressable
                  onPress={() =>
                    task.customerId &&
                    router.push({ pathname: '/customers/[id]', params: { id: task.customerId } })
                  }
                  style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
                  <View style={styles.time}>
                    <ThemedText type="smallBold" style={styles.timeText}>
                      {task.dueTime ?? '—'}
                    </ThemedText>
                  </View>
                  <View style={styles.body}>
                    <ThemedText type="smallBold" numberOfLines={1}>
                      {task.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {[customerName, TYPE_LABEL[task.type] ?? null].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  {task.customerId ? <Ionicons name="chevron-forward" size={16} color={c.textFaint} /> : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Αποστολή link ραντεβού"
                  onPress={() => openLink(task)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}>
                  <Ionicons name="paper-plane-outline" size={16} color={Brand.primary} />
                  <ThemedText type="small" style={styles.linkBtnText}>
                    Αποστολή link
                  </ThemedText>
                </Pressable>
              </View>
            );
          }}
        />
      )}

      <SheetModal visible={!!linkTask} title="Αποστολή link ραντεβού" onClose={closeLink}>
        {sent ? (
          <>
            <ThemedText type="smallBold" style={styles.dark}>
              Το link στάλθηκε στον πελάτη.
            </ThemedText>
            <PrimaryButton label="Κλείσιμο" onPress={closeLink} />
          </>
        ) : draft ? (
          <>
            <ThemedText type="smallBold">Μήνυμα προς {draft.recipient ?? linkCustomerName ?? 'πελάτη'}:</ThemedText>
            <View style={styles.msgBox}>
              <ThemedText type="small" style={styles.dark}>
                {draft.message}
              </ThemedText>
            </View>
            {draft.warning ? (
              <ThemedText type="small" themeColor="textSecondary">
                Προσοχή: λείπει η ώρα του ραντεβού.
              </ThemedText>
            ) : null}
            {linkError ? <ThemedText type="small" style={styles.error}>{linkError}</ThemedText> : null}
            <PrimaryButton label="Αποστολή (Viber)" onPress={() => void send()} busy={sending} />
            <PrimaryButton label="Πίσω" tone="outline" onPress={() => setDraft(null)} />
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">
              Δημιουργεί το μήνυμα επιβεβαίωσης με σύνδεσμο απάντησης για τον πελάτη.
            </ThemedText>
            {!linkTask?.customerId ? (
              <ThemedText type="small" style={styles.error}>
                Το ραντεβού δεν είναι συνδεδεμένο με πελάτη.
              </ThemedText>
            ) : null}
            {linkError ? <ThemedText type="small" style={styles.error}>{linkError}</ThemedText> : null}
            <PrimaryButton
              label="Δημιουργία μηνύματος"
              onPress={() => void buildDraft()}
              busy={drafting}
              disabled={!linkTask?.customerId}
            />
          </>
        )}
      </SheetModal>
    </ThemedView>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1 },
  headerSafe: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: 4, paddingBottom: Spacing.two },
  back: { padding: 4 },
  title: { fontSize: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  toggle: { flexDirection: 'row', gap: 4, marginHorizontal: Spacing.four, marginTop: Spacing.three, backgroundColor: c.surface, borderRadius: 12, padding: 4 },
  toggleBtn: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toggleBtnActive: { backgroundColor: c.card, shadowColor: '#11273B', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  toggleText: { color: c.textSecondary },
  toggleTextActive: { color: Brand.primary },
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: BottomTabInset + Spacing.four },
  groupHeader: { color: c.textSecondary, letterSpacing: 0.6, marginTop: Spacing.three, marginBottom: Spacing.one },
  groupHeaderOverdue: { color: '#D14343' },
  row: { backgroundColor: c.surface, borderRadius: 14, marginBottom: Spacing.two, overflow: 'hidden' },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  time: { minWidth: 46, alignItems: 'center' },
  timeText: { color: Brand.primary },
  body: { flex: 1, gap: 2 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one, borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 10 },
  linkBtnText: { color: Brand.primary, fontWeight: '700' },
  msgBox: { backgroundColor: c.surface, borderRadius: 14, padding: Spacing.three },
  dark: { color: c.text },
  error: { color: '#D14343' },
  pressed: { opacity: 0.6 },
});
