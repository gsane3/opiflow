// Στατιστικά — native parity with the web stats page. Pipeline value, won this
// month, win rate, customers-by-status, open offers/tasks, and a simple 6-month
// value bar list. Native Offer/Customer lack updatedAt/offerDate, so createdAt
// is used as the time proxy (documented divergence from web).

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiGet } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import type { Customer, Offer, Task } from '@/lib/types';

const OPEN_OFFER_STATUSES = new Set(['draft', 'ready_to_send', 'sent_manually', 'sent_provider']);
const STATUS_ROWS: Array<{ key: 'new' | 'in_progress' | 'won' | 'lost'; label: string; color: string }> = [
  { key: 'new', label: 'Νέοι', color: '#3361FF' },
  { key: 'in_progress', label: 'Σε εξέλιξη', color: '#B7791F' },
  { key: 'won', label: 'Κερδισμένοι', color: '#1B8A4C' },
  { key: 'lost', label: 'Χαμένοι', color: '#9AA4B2' },
];
const GREEK_MONTHS = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];

export default function StatsScreen() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, t, o] = await Promise.all([
        apiGet<{ customers?: Customer[] }>('/api/customers?limit=100'),
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=open&limit=100'),
        apiGet<{ offers?: Offer[] }>('/api/offers?limit=100'),
      ]);
      setCustomers(c?.customers ?? []);
      setTasks(t?.tasks ?? []);
      setOffers(o?.offers ?? []);
    } catch {
      // keep last
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const m = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const openCustomers = customers.filter((c) => c.status !== 'won' && c.status !== 'lost');
    const openOffers = offers.filter((o) => OPEN_OFFER_STATUSES.has(o.status));
    const pipelineFromCustomers = openCustomers.reduce((s, c) => s + (c.opportunityValue ?? 0), 0);
    const pipelineFromOffers = openOffers.reduce((s, o) => s + (o.total ?? 0), 0);
    const pipelineValue = pipelineFromCustomers > 0 ? pipelineFromCustomers : pipelineFromOffers;

    // createdAt proxy (native lacks updatedAt/offerDate).
    const wonOffersThisMonth = offers.filter((o) => o.status === 'accepted' && o.createdAt && new Date(o.createdAt) >= monthStart);
    const wonThisMonth = wonOffersThisMonth.reduce((s, o) => s + (o.total ?? 0), 0);

    const wonCount = customers.filter((c) => c.status === 'won').length;
    const lostCount = customers.filter((c) => c.status === 'lost').length;
    const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

    const statusCounts = STATUS_ROWS.map((r) => ({ ...r, count: customers.filter((c) => c.status === r.key).length }));

    const months: Array<{ key: string; label: string; value: number }> = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: GREEK_MONTHS[d.getMonth()], value: 0 });
    }
    for (const o of offers) {
      const day = o.createdAt?.slice(0, 7);
      if (!day) continue;
      const bucket = months.find((x) => x.key === day);
      if (bucket) bucket.value += o.total ?? 0;
    }
    const maxMonth = Math.max(...months.map((x) => x.value), 1);

    return {
      pipelineValue,
      wonThisMonth,
      winRate,
      openOffers: openOffers.length,
      openTasks: tasks.length,
      statusCounts,
      months,
      maxMonth,
      hasData: customers.length > 0 || offers.length > 0,
    };
  }, [customers, tasks, offers]);

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={28} color={Brand.primary} />
          </Pressable>
          <ThemedText type="subtitle" style={styles.title}>Στατιστικά</ThemedText>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Brand.primary} /></View>
      ) : !m.hasData ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">Δεν υπάρχουν ακόμα δεδομένα.</ThemedText>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={Brand.primary} />}>
          <View style={styles.cards}>
            <Metric label="Pipeline (σε εξέλιξη)" value={formatEuro(m.pipelineValue)} />
            <Metric label="Κερδισμένα (μήνας)" value={formatEuro(m.wonThisMonth)} />
            <Metric label="Ποσοστό επιτυχίας" value={`${m.winRate}%`} />
            <Metric label="Ανοιχτές προσφορές" value={String(m.openOffers)} />
            <Metric label="Εκκρεμότητες" value={String(m.openTasks)} />
          </View>

          <View style={styles.panel}>
            <ThemedText type="smallBold" style={styles.panelTitle}>Πελάτες ανά κατάσταση</ThemedText>
            {m.statusCounts.map((s) => (
              <View key={s.key} style={styles.statusRow}>
                <View style={[styles.dot, { backgroundColor: s.color }]} />
                <ThemedText type="small" style={styles.statusLabel}>{s.label}</ThemedText>
                <ThemedText type="smallBold">{s.count}</ThemedText>
              </View>
            ))}
          </View>

          <View style={styles.panel}>
            <ThemedText type="smallBold" style={styles.panelTitle}>Αξία προσφορών (6 μήνες)</ThemedText>
            {m.months.map((mo) => (
              <View key={mo.key} style={styles.monthRow}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.monthLabel}>{mo.label}</ThemedText>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.round((mo.value / m.maxMonth) * 100)}%` }]} />
                </View>
                <ThemedText type="small" style={styles.monthVal}>{formatEuro(mo.value)}</ThemedText>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </ThemedView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.metric}>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
      <ThemedText style={styles.metricValue}>{value}</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerSafe: { borderBottomWidth: 1, borderBottomColor: '#EEF1F5', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: 4 },
  back: { padding: 4 },
  title: { fontSize: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metric: { width: '47.8%', flexGrow: 1, padding: Spacing.three, borderRadius: 16, gap: 4 },
  metricValue: { fontSize: 22, fontWeight: '800' },
  panel: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: Spacing.three, gap: Spacing.one, borderWidth: 1, borderColor: '#EEF1F5' },
  panelTitle: { marginBottom: Spacing.one },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { flex: 1 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 5 },
  monthLabel: { width: 34 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#F2F4F7', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: Brand.primary },
  monthVal: { width: 76, textAlign: 'right' },
});
