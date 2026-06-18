// Εργασίες — native parity with the web tasks screen. Tabs Σήμερα / Εκκρεμείς /
// Ολοκληρωμένες; complete / snooze (+1 ημέρα) / ακύρωση via PATCH /api/tasks/[id];
// tap a task → open its customer.

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChipSelect, PrimaryButton } from '@/components/ui';
import { BottomTabInset, Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPatch } from '@/lib/api';
import { todayYMD } from '@/lib/format';
import type { Customer, Task } from '@/lib/types';

const TYPE_LABEL: Record<string, string> = {
  call_back: 'Κλήση πίσω',
  follow_up_offer: 'Παρακολούθηση προσφοράς',
  send_offer: 'Αποστολή προσφοράς',
  ask_for_photos_documents: 'Αίτημα στοιχείων',
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη',
  wait_for_reply: 'Αναμονή απάντησης',
  other: 'Εργασία',
};

const TABS = [
  { key: 'today', label: 'Σήμερα' },
  { key: 'open', label: 'Εκκρεμείς' },
  { key: 'done', label: 'Ολοκληρωμένες' },
];

export default function TasksScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const [tab, setTab] = useState('today');
  const [open, setOpen] = useState<Task[]>([]);
  const [done, setDone] = useState<Task[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, d, c] = await Promise.all([
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=open&limit=200'),
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=completed&limit=100'),
        apiGet<{ customers?: Customer[] }>('/api/customers?limit=100'),
      ]);
      setOpen(o?.tasks ?? []);
      setDone(d?.tasks ?? []);
      const map: Record<string, string> = {};
      for (const cu of c?.customers ?? []) map[cu.id] = cu.name ?? 'Πελάτης';
      setNames(map);
      setError(false);
    } catch {
      // Distinguish a network error from a genuinely empty list.
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const today = todayYMD();
  const list = useMemo(() => {
    if (tab === 'done') return done;
    const sorted = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (tab === 'today') return sorted.filter((t) => t.dueDate <= today);
    return sorted;
  }, [tab, open, done, today]);

  async function complete(t: Task) {
    setOpen((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await apiPatch(`/api/tasks/${t.id}`, { status: 'completed' });
    } catch {
      void load();
    }
  }

  function actions(t: Task) {
    Alert.alert(t.title, undefined, [
      { text: 'Ολοκλήρωση', onPress: () => void complete(t) },
      {
        text: 'Αναβολή +1 ημέρα',
        onPress: async () => {
          const d = new Date(`${t.dueDate}T00:00:00`);
          d.setDate(d.getDate() + 1);
          const next = d.toISOString().slice(0, 10);
          setOpen((prev) => prev.map((x) => (x.id === t.id ? { ...x, dueDate: next } : x)));
          try { await apiPatch(`/api/tasks/${t.id}`, { dueDate: next }); } catch { void load(); }
        },
      },
      {
        text: 'Ακύρωση εργασίας',
        style: 'destructive',
        onPress: async () => {
          setOpen((prev) => prev.filter((x) => x.id !== t.id));
          try { await apiPatch(`/api/tasks/${t.id}`, { status: 'cancelled' }); } catch { void load(); }
        },
      },
      { text: 'Κλείσιμο', style: 'cancel' },
    ]);
  }

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={28} color={Brand.primary} />
          </Pressable>
          <ThemedText type="subtitle" style={styles.title}>Εργασίες</ThemedText>
        </View>
        <View style={styles.tabsWrap}>
          <ChipSelect options={TABS} value={tab} onChange={setTab} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Brand.primary} /></View>
      ) : error && list.length === 0 ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary" style={styles.errorText}>Δεν φορτώθηκαν τα στοιχεία.</ThemedText>
          <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={() => { setLoading(true); void load(); }} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">
            {tab === 'done' ? 'Καμία ολοκληρωμένη εργασία.' : 'Καμία εκκρεμότητα.'}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(t) => t.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={Brand.primary} />}
          renderItem={({ item }) => {
            const overdue = tab !== 'done' && item.dueDate < today;
            const isDone = item.status === 'completed';
            return (
              <View style={styles.card}>
                <Pressable
                  onPress={() => item.customerId && router.push({ pathname: '/customers/[id]', params: { id: item.customerId } })}
                  onLongPress={() => !isDone && actions(item)}
                  style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
                  {isDone ? <Ionicons name="checkmark-circle" size={24} color="#1B8A4C" /> : null}
                  <View style={styles.body}>
                    <ThemedText type="smallBold" numberOfLines={1}>{item.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={overdue ? styles.overdue : undefined}>
                      {[names[item.customerId ?? ''], TYPE_LABEL[item.type] ?? null, `${overdue ? 'Εκπρόθεσμο · ' : ''}${item.dueDate.split('-').reverse().join('-')}${item.dueTime ? ` ${item.dueTime}` : ''}`].filter(Boolean).join(' · ')}
                    </ThemedText>
                  </View>
                  {!isDone ? (
                    <Pressable accessibilityRole="button" accessibilityLabel="Περισσότερες ενέργειες" onPress={() => actions(item)} hitSlop={8} style={styles.more}>
                      <Ionicons name="ellipsis-horizontal" size={20} color={c.textFaint} />
                    </Pressable>
                  ) : null}
                </Pressable>
                {/* Primary action made visible (was hidden behind long-press). */}
                {!isDone ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Ολοκλήρωση"
                    onPress={() => void complete(item)}
                    style={({ pressed }) => [styles.completeBtn, pressed && styles.pressed]}>
                    <Ionicons name="checkmark-circle-outline" size={18} color={Brand.primary} />
                    <ThemedText type="small" style={styles.completeBtnText}>Ολοκλήρωση</ThemedText>
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </ThemedView>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1 },
  headerSafe: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: 4 },
  back: { padding: 4 },
  title: { fontSize: 22 },
  tabsWrap: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two, paddingTop: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: BottomTabInset + Spacing.four },
  card: { backgroundColor: c.surface, borderRadius: 14, marginBottom: Spacing.two, overflow: 'hidden' },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.three },
  body: { flex: 1, gap: 2 },
  more: { padding: 4 },
  completeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.one, borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 10 },
  completeBtnText: { color: Brand.primary, fontWeight: '700' },
  overdue: { color: '#D14343', fontWeight: '700' },
  errorText: { marginBottom: Spacing.three },
  pressed: { opacity: 0.6 },
});
