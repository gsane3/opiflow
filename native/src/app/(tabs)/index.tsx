// Αρχική — today's appointments, follow-up calls, quick stats, recent activity.
// Mirrors the web dashboard's data (customers/tasks/offers/communications APIs).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CallActionSheet } from '@/components/call-action-sheet';
import { NotificationsSheet, type NotificationItem } from '@/components/notifications-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Shadow, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPatch } from '@/lib/api';
import { hapticSuccess } from '@/lib/haptics';
import { briefExcerpt, formatWhen, todayYMD } from '@/lib/format';
import { getIncomingState, subscribeIncomingState } from '@/lib/twilio-state';
import type { Communication, Customer, Offer, Task } from '@/lib/types';

const NOTIF_SEEN_KEY = 'opiflow:notif_last_seen';

export default function HomeScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [recent, setRecent] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetCall, setSheetCall] = useState<Communication | null>(null);

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

  // «Το τηλέφωνο δεν χτυπάει» must be visible on the Home screen — not buried
  // in Ρυθμίσεις. Tapping the banner retries registration.
  const [phoneState, setPhoneState] = useState(getIncomingState().state);
  // pushConfigured=false → registered, but a closed app won't ring (no push
  // credential for this platform — owner infra). Shown as an info banner.
  const [pushConfigured, setPushConfigured] = useState<boolean | undefined>(getIncomingState().pushConfigured);
  useEffect(() => subscribeIncomingState(() => {
    const s = getIncomingState();
    setPhoneState(s.state);
    setPushConfigured(s.pushConfigured);
  }), []);
  const reconnectPhone = useCallback(async () => {
    try {
      const { registerForIncoming } = await import('@/lib/twilio');
      await registerForIncoming();
    } catch {
      // state stays 'error'; the banner remains tappable
    }
  }, []);

  // Notifications bell + unread badge.
  const [notifOpen, setNotifOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(async () => {
    try {
      const [res, seen] = await Promise.all([
        apiGet<{ notifications?: NotificationItem[] }>('/api/notifications'),
        AsyncStorage.getItem(NOTIF_SEEN_KEY),
      ]);
      const lastSeen = seen ?? '';
      setUnread((res?.notifications ?? []).filter((n) => n.eventAt > lastSeen).length);
    } catch {
      // ignore — badge just stays as-is
    }
  }, []);
  useEffect(() => { void refreshUnread(); }, [refreshUnread]);
  async function openNotifications() {
    setNotifOpen(true);
    setUnread(0);
    try { await AsyncStorage.setItem(NOTIF_SEEN_KEY, new Date().toISOString()); } catch { /* non-fatal */ }
  }

  const customerName = useCallback(
    (id: string | null | undefined) => customers.find((c) => c.id === id)?.name ?? null,
    [customers],
  );
  const customerById = useCallback(
    (id: string | null | undefined) => customers.find((c) => c.id === id) ?? null,
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
    void hapticSuccess();
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
            <View style={{ flex: 1 }}>
              <ThemedText type="subtitle" style={styles.headerTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {greeting}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                {new Date().toLocaleDateString('el-GR', { weekday: 'long', day: 'numeric', month: 'long' })}
              </ThemedText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Ειδοποιήσεις" onPress={() => void openNotifications()} hitSlop={8} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}>
              <Ionicons name="notifications" size={22} color={Brand.primary} />
              {unread > 0 ? (
                <View style={styles.badge}>
                  <ThemedText style={styles.badgeText}>{unread > 9 ? '9+' : unread}</ThemedText>
                </View>
              ) : null}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Αναζήτηση" onPress={() => router.push('/search' as never)} hitSlop={8} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}>
              <Ionicons name="search" size={22} color={Brand.primary} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Στατιστικά" onPress={() => router.push('/stats' as never)} hitSlop={8} style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}>
              <Ionicons name="stats-chart" size={22} color={Brand.primary} />
            </Pressable>
          </View>

          {/* Quick links to the secondary screens (hidden from the tab bar). */}
          <View style={styles.quickLinks}>
            <QuickLink icon="checkbox" label="Εργασίες" onPress={() => router.push('/tasks' as never)} />
            <QuickLink icon="calendar" label="Ραντεβού" onPress={() => router.push('/appointments' as never)} />
            <QuickLink icon="document-text" label="Προσφορές" onPress={() => router.push('/offers' as never)} />
          </View>

          {phoneState === 'error' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Επανασύνδεση τηλεφώνου"
              onPress={() => void reconnectPhone()}
              style={({ pressed }) => [styles.phoneBanner, pressed && styles.pressed]}>
              <Ionicons name="warning" size={16} color="#FFFFFF" />
              <ThemedText type="small" style={styles.phoneBannerText}>
                Το τηλέφωνο δεν είναι συνδεδεμένο — πάτα για επανασύνδεση
              </ThemedText>
            </Pressable>
          ) : null}

          {phoneState === 'registered' && pushConfigured === false ? (
            <View style={styles.pushWarnBanner}>
              <Ionicons name="information-circle" size={16} color="#9A6200" />
              <ThemedText type="small" style={styles.pushWarnText}>
                Οι κλήσεις δεν θα χτυπούν με κλειστή/κλειδωμένη εφαρμογή μέχρι να ρυθμιστεί το push (διαχειριστής).
              </ThemedText>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={Brand.primary} />
            </View>
          ) : (
            <>
              {/* Stats */}
              <View style={styles.statsRow}>
                <StatCard icon="person-add" label="Νέοι πελάτες" value={stats.newThisMonth} tone="brand" onPress={() => router.push('/customers/index')} />
                <StatCard icon="calendar" label="Ραντεβού σήμερα" value={stats.apptsToday} tone="sky" onPress={() => router.push('/appointments' as never)} />
              </View>
              <View style={styles.statsRow}>
                <StatCard icon="checkbox" label="Εκκρεμότητες" value={stats.openTasks} tone="amber" onPress={() => router.push('/tasks' as never)} />
                <StatCard icon="document-text" label="Προσφορές" value={stats.openOffers} tone="violet" onPress={() => router.push('/offers' as never)} />
              </View>

              {/* Today's appointments */}
              <SectionTitle icon="calendar" title="Σήμερα" />
              {appointmentsToday.length === 0 ? (
                <EmptyHint text="Κανένα ραντεβού σήμερα." />
              ) : (
                appointmentsToday.map((t) => {
                  const cust = customerById(t.customerId);
                  const phone = cust?.mobilePhone || cust?.phone || cust?.landlinePhone || null;
                  return (
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
                        {cust?.name ? (
                          <ThemedText type="small" themeColor="textSecondary">
                            {cust.name}
                          </ThemedText>
                        ) : null}
                      </View>
                      {/* Driving between jobs: call + navigate in ONE tap from the card. */}
                      {phone ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Κλήση"
                          onPress={() => router.push({ pathname: '/calls', params: { num: phone } })}
                          hitSlop={8}
                          style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}>
                          <Ionicons name="call" size={17} color={Brand.primary} />
                        </Pressable>
                      ) : null}
                      {cust?.address ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Πλοήγηση"
                          onPress={() =>
                            void Linking.openURL(
                              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cust.address ?? '')}`,
                            )
                          }
                          hitSlop={8}
                          style={({ pressed }) => [styles.cardAction, pressed && styles.pressed]}>
                          <Ionicons name="navigate" size={17} color={Brand.primary} />
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                })
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
                        accessibilityRole="button"
                        accessibilityLabel="Ολοκλήρωση εργασίας"
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
                    onPress={() => {
                      // Calls open the action sheet (full brief + ενέργειες);
                      // anything else jumps to the customer when linked.
                      if (m.channel === 'call') setSheetCall(m);
                      else if (m.customerId)
                        router.push({ pathname: '/customers/[id]', params: { id: m.customerId } });
                    }}
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

      <CallActionSheet
        call={sheetCall}
        onClose={() => setSheetCall(null)}
        onChanged={() => void load()}
        onOpenCustomer={(cid) => router.push({ pathname: '/customers/[id]', params: { id: cid } })}
        onDial={(phone) => router.push({ pathname: '/calls', params: { num: phone } })}
      />

      <NotificationsSheet
        visible={notifOpen}
        onClose={() => { setNotifOpen(false); void refreshUnread(); }}
        onOpenCustomer={(cid) => { setNotifOpen(false); router.push({ pathname: '/customers/[id]', params: { id: cid } }); }}
      />
    </ThemedView>
  );
}

// Light-tinted accent chips per metric — parity with the web KPI cards (B1).
const ACCENT_CHIP: Record<string, { bg: string; fg: string }> = {
  brand:  { bg: '#E7F0F8', fg: '#2A86C5' }, // customers — water-blue
  sky:    { bg: '#E6F1FA', fg: '#1E88C5' }, // appointments — sky
  amber:  { bg: '#FBF1E0', fg: '#E0922F' }, // tasks — amber
  violet: { bg: '#EEE9FA', fg: '#7C5CCB' }, // offers — violet
};

function StatCard({
  icon,
  label,
  value,
  onPress,
  tone = 'brand',
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: number;
  onPress?: () => void;
  tone?: 'brand' | 'sky' | 'amber' | 'violet';
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const chip = ACCENT_CHIP[tone];
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.statCardWrap, pressed && styles.pressed]}>
      <View style={styles.statCard}>
        <View style={[styles.statIcon, { backgroundColor: chip.bg }]}>
          <Ionicons name={icon} size={20} color={chip.fg} />
        </View>
        <ThemedText style={styles.statValue}>{value}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function QuickLink({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickLink, pressed && styles.pressed]}>
      <Ionicons name={icon} size={18} color={Brand.primary} />
      <ThemedText type="small" style={styles.quickLinkText}>{label}</ThemedText>
    </Pressable>
  );
}

function SectionTitle({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
      {text}
    </ThemedText>
  );
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    container: { flex: 1 },
    safe: { flex: 1 },
    content: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
    header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.four, paddingBottom: Spacing.three },
    headerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#D14343', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
    badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
    quickLinks: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
    quickLink: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 15, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, ...Shadow.card },
    quickLinkText: { color: Brand.navy, fontWeight: '700' },
    headerTitle: { fontSize: 26, lineHeight: 32 },
    logo: { width: 48, height: 48, borderRadius: 14, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
    logoMark: { color: Brand.onPrimary, fontSize: 26, lineHeight: 32, fontWeight: '800' },
    loadingBox: { paddingVertical: Spacing.six, alignItems: 'center' },

    statsRow: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.two },
    statCardWrap: { flex: 1 },
    statCard: { padding: Spacing.three, borderRadius: 22, gap: 4, backgroundColor: c.card, borderWidth: 1, borderColor: c.borderFaint, ...Shadow.card },
    statIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
    statValue: { fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: -0.5, color: c.text },

    sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.four, marginBottom: Spacing.two },
    sectionTitleText: { fontSize: 15 },
    emptyHint: { paddingVertical: Spacing.two },

    itemCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.three,
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: Spacing.three,
      marginBottom: Spacing.two,
    },
    itemBody: { flex: 1, gap: 2 },
    timePill: { backgroundColor: Brand.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, minWidth: 52, alignItems: 'center' },
    timePillText: { color: Brand.primary, fontWeight: '800', fontSize: 14 },
    overdue: { color: '#D14343', fontWeight: '700' },
    doneBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
    cardAction: { width: 38, height: 38, borderRadius: 19, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },

    phoneBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.two,
      backgroundColor: '#D14343',
      borderRadius: 12,
      paddingHorizontal: Spacing.three,
      paddingVertical: 10,
      marginBottom: Spacing.two,
    },
    phoneBannerText: { color: '#FFFFFF', fontWeight: '700', flex: 1 },

    pushWarnBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.two,
      backgroundColor: '#FBE9C7',
      borderRadius: 12,
      paddingHorizontal: Spacing.three,
      paddingVertical: 10,
      marginBottom: Spacing.two,
    },
    pushWarnText: { color: '#9A6200', fontWeight: '700', flex: 1 },

    pressed: { opacity: 0.7 },
  });
