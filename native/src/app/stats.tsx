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
import { BottomTabInset, Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet } from '@/lib/api';
import { formatEuro, todayYMD } from '@/lib/format';
import type { Communication, Customer, Offer, Task } from '@/lib/types';

const OPEN_OFFER_STATUSES = new Set(['draft', 'ready_to_send', 'sent_manually', 'sent_provider']);
const STATUS_ROWS: Array<{ key: 'new' | 'in_progress' | 'won' | 'lost'; label: string; color: string }> = [
  { key: 'new', label: 'Νέοι', color: '#3361FF' },
  { key: 'in_progress', label: 'Σε εξέλιξη', color: '#B7791F' },
  { key: 'won', label: 'Κερδισμένοι', color: '#1B8A4C' },
  { key: 'lost', label: 'Χαμένοι', color: '#9AA4B2' },
];
const GREEK_MONTHS = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];

export default function StatsScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [calls, setCalls] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, t, o, k] = await Promise.all([
        apiGet<{ customers?: Customer[] }>('/api/customers?limit=100'),
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=open&limit=100'),
        apiGet<{ offers?: Offer[] }>('/api/offers?limit=100'),
        apiGet<{ communications?: Communication[] }>('/api/communications?channel=call&limit=100'),
      ]);
      setCustomers(c?.customers ?? []);
      setTasks(t?.tasks ?? []);
      setOffers(o?.offers ?? []);
      setCalls(k?.communications ?? []);
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
    const decided = wonCount + lostCount;
    const winRate = decided > 0 ? Math.round((wonCount / decided) * 100) : null;

    // Τηλέφωνο — real telephony data (this is Opiflow's home turf; the
    // douleutaras «Κοντέρ» can only approximate response behaviour).
    const inbound = calls.filter((k) => k.direction === 'inbound');
    const missed = inbound.filter((k) => k.status === 'missed' || k.status === 'failed');
    const answerRate = inbound.length > 0 ? Math.round(((inbound.length - missed.length) / inbound.length) * 100) : null;
    const today = todayYMD();
    const overdueTasks = tasks.filter((t) => t.dueDate && t.dueDate < today).length;

    // «Σκορ» v1 — one number the owner can improve (0–100):
    //   50% answer rate + 25% task hygiene (μη-εκπρόθεσμες) + 25% win rate.
    // Missing components (no calls / no decided offers) redistribute to the rest.
    const parts: Array<{ w: number; v: number }> = [];
    if (answerRate !== null) parts.push({ w: 2, v: answerRate });
    if (tasks.length > 0) parts.push({ w: 1, v: Math.round(((tasks.length - overdueTasks) / tasks.length) * 100) });
    if (winRate !== null) parts.push({ w: 1, v: winRate });
    const totalW = parts.reduce((s, p) => s + p.w, 0);
    const score = totalW > 0 ? Math.round(parts.reduce((s, p) => s + p.w * p.v, 0) / totalW) : null;

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
    // Drop leading zero-months — four «0,00 €» rows carry no information.
    const firstWithData = months.findIndex((x) => x.value > 0);
    const trimmedMonths = firstWithData > 0 ? months.slice(firstWithData) : months;
    const maxMonth = Math.max(...trimmedMonths.map((x) => x.value), 1);

    return {
      pipelineValue,
      wonThisMonth,
      winRate,
      wonCount,
      decided,
      answerRate,
      missedCount: missed.length,
      inboundCount: inbound.length,
      overdueTasks,
      score,
      openOffers: openOffers.length,
      openTasks: tasks.length,
      statusCounts,
      months: trimmedMonths,
      maxMonth,
      hasData: customers.length > 0 || offers.length > 0,
    };
  }, [customers, tasks, offers, calls]);

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
          {m.score !== null ? (
            <View style={styles.scorePanel}>
              <View style={styles.scoreHead}>
                <ThemedText type="smallBold">Σκορ επιχείρησης</ThemedText>
                <ThemedText style={[styles.scoreValue, { color: scoreColor(m.score) }]}>{m.score}</ThemedText>
              </View>
              <View style={styles.scoreTrack}>
                <View style={[styles.scoreFill, { width: `${m.score}%`, backgroundColor: scoreColor(m.score) }]} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Απαντημένες κλήσεις + εργασίες στην ώρα τους + κερδισμένες προσφορές
              </ThemedText>
              {m.answerRate !== null ? (
                <VerdictRow
                  label="Ποσοστό απάντησης"
                  value={`${m.answerRate}%`}
                  good={m.answerRate >= 80}
                  hint={`${m.missedCount} αναπάντητες σε ${m.inboundCount} εισερχόμενες`}
                />
              ) : null}
              <VerdictRow
                label="Εκπρόθεσμες εργασίες"
                value={String(m.overdueTasks)}
                good={m.overdueTasks === 0}
                hint={m.overdueTasks > 0 ? 'Κλείσε τις παλιές για να ανέβει το σκορ' : 'Όλα στην ώρα τους'}
              />
            </View>
          ) : null}

          <View style={styles.cards}>
            <Metric label="Σε εξέλιξη (αξία)" value={formatEuro(m.pipelineValue)} />
            <Metric label="Κερδισμένα (μήνας)" value={formatEuro(m.wonThisMonth)} />
            <Metric
              label="Ποσοστό επιτυχίας"
              value={m.winRate === null ? '—' : `${m.winRate}% (${m.wonCount}/${m.decided})`}
            />
            <Metric label="Ανοιχτές προσφορές" value={String(m.openOffers)} onPress={() => router.push('/offers' as never)} />
            <Metric label="Εργασίες" value={String(m.openTasks)} onPress={() => router.push('/tasks' as never)} />
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
                <ThemedText type="small" style={styles.monthVal} numberOfLines={1} adjustsFontSizeToFit>
                  {formatEuro(mo.value)}
                </ThemedText>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </ThemedView>
  );
}

function scoreColor(score: number): string {
  if (score >= 70) return '#1B8A4C';
  if (score >= 30) return '#E0922F';
  return '#D14343';
}

function Metric({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const body = (
    <ThemedView type="backgroundElement" style={styles.metric}>
      <View style={styles.metricHead}>
        <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
        {onPress ? <Ionicons name="chevron-forward" size={14} color={Brand.primary} /> : null}
      </View>
      <ThemedText style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit>{value}</ThemedText>
    </ThemedView>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.metricWrap, pressed && { opacity: 0.7 }]}>
      {body}
    </Pressable>
  );
}

// douleutaras-style verdict line: value + 👍/👎 + one-line explanation.
function VerdictRow({ label, value, good, hint }: { label: string; value: string; good: boolean; hint: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.verdictRow}>
      <Ionicons name={good ? 'thumbs-up' : 'thumbs-down'} size={16} color={good ? '#1B8A4C' : '#D14343'} />
      <View style={styles.verdictBody}>
        <ThemedText type="small">
          {label}: <ThemedText type="smallBold">{value}</ThemedText>
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{hint}</ThemedText>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1 },
  headerSafe: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: 4 },
  back: { padding: 4 },
  title: { fontSize: 22 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metricWrap: { width: '47.8%', flexGrow: 1 },
  metric: { width: '100%', minWidth: '47.8%', flexGrow: 1, padding: Spacing.three, borderRadius: 16, gap: 4 },
  metricHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricValue: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  scorePanel: { backgroundColor: c.card, borderRadius: 16, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: c.border },
  scoreHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scoreValue: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  scoreTrack: { height: 10, borderRadius: 5, backgroundColor: c.surface, overflow: 'hidden' },
  scoreFill: { height: 10, borderRadius: 5 },
  verdictRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingTop: Spacing.one },
  verdictBody: { flex: 1, gap: 1 },
  panel: { backgroundColor: c.card, borderRadius: 16, padding: Spacing.three, gap: Spacing.one, borderWidth: 1, borderColor: c.border },
  panelTitle: { marginBottom: Spacing.one },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { flex: 1 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 5 },
  monthLabel: { width: 34 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.surface, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: Brand.primary },
  monthVal: { width: 76, textAlign: 'right' },
});
