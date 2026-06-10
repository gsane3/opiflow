// Αρχική — today's appointments, follow-up calls, quick stats, recent activity.
// Mirrors the web dashboard's data (customers/tasks/offers/communications APIs).

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiGet, apiPatch } from '@/lib/api';
import { briefExcerpt, formatWhen, todayYMD } from '@/lib/format';
import type { Communication, Customer, Offer, Task } from '@/lib/types';

export default function HomeScreen() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [recent, setRecent] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, t, o, m] = await Promise.all([
        apiGet<{ customers?: Customer[] }>('/api/customers?limit=100'),
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=open&limit=100'),
        apiGet<{ offers?: Offer[] }>('/api/offers?limit=100'),
        apiGet<{ communications?: Communication[] }>('/api/communications?limit=5'),
      ]);
      setCustomers(c?.customers ?? []);
      setTasks(t?.tasks ?? []);
      setOffers(o?.offers ?? []);
      setRecent(m?.communications ?? []);
    } catch {
      // keep last data; pull-to-refresh retries
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const customerName = useCallback(
    (id: string | null | undefined) => customers.find((c) => c.id === id)?.name ?? null,
    [customers],
  );

  const today = todayYMD();
  const appointmentsToday = useMemo(
    () =>
      tasks
        .filter((t) => (t.type === 'book_appointment' || t.type === 'visit_customer') && t.dueDate === today)
        .sort((a, b) => (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99')),
    [tasks, today],
  );
  const followUps = useMemo(
    () =>
      tasks
        .filter((t) => t.type === 'call_back' || t.type === 'follow_up_offer')
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 5),
    [tasks],
  );

  const monthStart = today.slice(0, 7);
  const stats = useMemo(
    () => ({
      newThisMonth: customers.filter((c) => (c.createdAt ?? '').slice(0, 7) === monthStart).length,
      openTasks: tasks.length,
      openOffers: offers.filter((o) => ['draft', 'ready_to_send', 'sent_manually', 'sent_provider'].includes(o.status)).length,
      apptsToday: appointmentsToday.length,
    }),
    [customers, tasks, offers, appointmentsToday, monthStart],
  );

  async function completeTask(id: string) {
    setTasks((ts) => ts.filter((t) => t.id !== id));
    try {
      await apiPatch(`/api/tasks/${id}`, { status: 'completed' });
    } catch {
      void load();
    }
  }

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Καλημέρα';
    if (h < 18) return 'Καλησπέρα';
    return 'Καλό βράδυ';
  })();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={Brand.primary}
            />
          }>
          <View style={styles.header}>
            <View style={styles.logo}>
              <ThemedText style={styles.logoMark}>O</ThemedText>
            </View>
            <View>
              <ThemedText type="subtitle" style={styles.headerTitle}>
                {greeting}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </ThemedText>
            </View>
          </View>

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={Brand.primary} />
            </View>
          ) : (
            <>
              {/* Stats */}
              <View style={styles.statsRow}>
                <StatCard icon="person-add" label="Νέοι (μήνας)" value={stats.newThisMonth} />
                <StatCard icon="calendar" label="Ραντεβού σήμερα" value={stats.apptsToday} />
              </View>
              <View style={styles.statsRow}>
                <StatCard icon="checkbox" label="Εκκρεμότητες" value={stats.openTasks} />
                <StatCard icon="document-text" label="Ανοιχτές προσφορές" value={stats.openOffers} />
              </View>

              {/* Today's appointments */}
              <SectionTitle icon="calendar" title="Σήμερα" />
              {appointmentsToday.length === 0 ? (
                <EmptyHint text="Κανένα ραντεβού σήμερα." />
              ) : (
                appointmentsToday.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() =>
                      t.customerId &&
                      router.push({ pathname: '/customers/[id]', params: { id: t.customerId } })
                    }
                    style={({ pressed }) => [styles.itemCard, pressed && styles.pressed]}>
                    <View style={styles.timePill}>
                      <ThemedText style={styles.timePillText}>{t.dueTime ?? '—'}</ThemedText>
                    </View>
                    <View style={styles.itemBody}>
                      <ThemedText type="smallBold">{t.title}</ThemedText>
                      {customerName(t.customerId) ? (
                        <ThemedText type="small" themeColor="textSecondary">
                          {customerName(t.customerId)}
                        </ThemedText>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#9AA4B2" />
                  </Pressable>
                ))
              )}

              {/* Follow-ups */}
              <SectionTitle icon="call" title="Να πάρω τηλέφωνο" />
              {followUps.length === 0 ? (
                <EmptyHint text="Καμία εκκρεμής επικοινωνία." />
              ) : (
                followUps.map((t) => {
                  const overdue = t.dueDate < today;
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() =>
                        t.customerId &&
                        router.push({ pathname: '/customers/[id]', params: { id: t.customerId } })
                      }
                      style={({ pressed }) => [styles.itemCard, pressed && styles.pressed]}>
                      <View style={styles.itemBody}>
                        <ThemedText type="smallBold">
                          {customerName(t.customerId) ?? t.title}
                        </ThemedText>
                        <ThemedText
                          type="small"
                          themeColor="textSecondary"
                          style={overdue ? styles.overdue : undefined}>
                          {overdue ? 'Εκπρόθεσμο · ' : ''}
                          {t.dueDate.split('-').reverse().join('-')}
                          {t.note ? ` · ${t.note.slice(0, 40)}` : ''}
                        </ThemedText>
                      </View>
                      <Pressable
                        onPress={() => void completeTask(t.id)}
                        hitSlop={8}
                        style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed]}>
                        <Ionicons name="checkmark" size={18} color={Brand.primary} />
                      </Pressable>
                    </Pressable>
                  );
                })
              )}

              {/* Recent activity */}
              <SectionTitle icon="time" title="Πρόσφατη δραστηριότητα" />
              {recent.length === 0 ? (
                <EmptyHint text="Καμία πρόσφατη επικοινωνία." />
              ) : (
                recent.map((m) => (
                  <Pressable
                    key={m.id}
                    onPress={() =>
                      m.customerId &&
                      router.push({ pathname: '/customers/[id]', params: { id: m.customerId } })
                    }
                    style={({ pressed }) => [styles.itemCard, pressed && styles.pressed]}>
                    <Ionicons
                      name={
                        m.channel === 'call'
                          ? m.direction === 'inbound'
                            ? 'arrow-down-circle'
                            : 'arrow-up-circle'
                          : 'chatbubble'
                      }
                      size={22}
                      color={m.status === 'failed' ? '#D14343' : Brand.primary}
                    />
                    <View style={styles.itemBody}>
                      <ThemedText type="smallBold">
                        {m.customer?.name ?? m.phone ?? 'Άγνωστος'}
                      </ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {briefExcerpt(m.summary) || (m.channel === 'call' ? 'Κλήση' : m.channel.toUpperCase())}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatWhen(m.createdAt)}
                    </ThemedText>
                  </Pressable>
                ))
              )}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.statCard}>
      <Ionicons name={icon} size={18} color={Brand.primary} />
      <ThemedText style={styles.statValue}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </ThemedView>
  );
}

function SectionTitle({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Ionicons name={icon} size={16} color={Brand.primary} />
      <ThemedText type="smallBold" style={styles.sectionTitleText}>
        {title}
      </ThemedText>
    </View>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
      {text}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  content: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.three },
  headerTitle: { fontSize: 26, lineHeight: 32 },
  logo: { width: 48, height: 48, borderRadius: 14, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  logoMark: { color: Brand.onPrimary, fontSize: 26, fontWeight: '800' },
  loadingBox: { paddingVertical: Spacing.six, alignItems: 'center' },

  statsRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
  statCard: { flex: 1, padding: Spacing.three, borderRadius: 16, gap: 4 },
  statValue: { fontSize: 24, fontWeight: '800' },

  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.four, marginBottom: Spacing.two },
  sectionTitleText: { fontSize: 15 },
  emptyHint: { paddingVertical: Spacing.two },

  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: '#F7F9FB',
    borderRadius: 14,
    padding: Spacing.three,
    marginBottom: Spacing.two,
  },
  itemBody: { flex: 1, gap: 2 },
  timePill: { backgroundColor: Brand.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, minWidth: 52, alignItems: 'center' },
  timePillText: { color: Brand.primary, fontWeight: '800', fontSize: 14 },
  overdue: { color: '#D14343', fontWeight: '700' },
  doneBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
});
