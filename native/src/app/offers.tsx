// Προσφορές — native parity with the web offers screen. Status group tabs
// Όλες / Πρόχειρες-Έτοιμες / Στάλθηκαν / Αποδεκτές / Απορρίφθηκαν; tap a row to
// open the full offer document (OfferPreviewSheet) with status + send actions.

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfferPreviewSheet } from '@/components/offer-preview-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChipSelect } from '@/components/ui';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiGet } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import type { Customer, Offer } from '@/lib/types';

// Plain Greek status label for each row (mirrors the web status machine copy).
const STATUS_LABEL: Record<string, string> = {
  draft: 'Πρόχειρη',
  ready_to_send: 'Έτοιμη για αποστολή',
  sent_manually: 'Στάλθηκε',
  sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
  cancelled: 'Ακυρώθηκε',
};

// Status group tabs: each maps to a set of underlying offer statuses so the
// user sees plain categories instead of the raw status machine ([] = all).
const TABS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: 'all', label: 'Όλες', statuses: [] },
  { key: 'drafts', label: 'Πρόχειρες-Έτοιμες', statuses: ['draft', 'ready_to_send'] },
  { key: 'sent', label: 'Στάλθηκαν', statuses: ['sent_manually', 'sent_provider'] },
  { key: 'accepted', label: 'Αποδεκτές', statuses: ['accepted'] },
  { key: 'rejected', label: 'Απορρίφθηκαν', statuses: ['rejected'] },
];

export default function OffersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState('all');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, c] = await Promise.all([
        apiGet<{ offers?: Offer[] }>('/api/offers?limit=100'),
        apiGet<{ customers?: Customer[] }>('/api/customers?limit=100'),
      ]);
      setOffers(o?.offers ?? []);
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

  useEffect(() => { void load(); }, [load]);

  const groupStatuses = useMemo(
    () => TABS.find((t) => t.key === tab)?.statuses ?? [],
    [tab],
  );

  const list = useMemo(() => {
    if (groupStatuses.length === 0) return offers;
    return offers.filter((o) => groupStatuses.includes(o.status));
  }, [offers, groupStatuses]);

  const summaryTotal = useMemo(
    () => list.reduce((sum, o) => sum + (o.total ?? 0), 0),
    [list],
  );

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={28} color={Brand.primary} />
          </Pressable>
          <ThemedText type="subtitle" style={styles.title}>Προσφορές</ThemedText>
        </View>
        <View style={styles.tabsWrap}>
          <ChipSelect options={TABS} value={tab} onChange={setTab} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Brand.primary} /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">Καμία προσφορά.</ThemedText>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={Brand.primary} />}
          ListHeaderComponent={
            <View style={styles.summary}>
              <ThemedText type="small" themeColor="textSecondary">
                {`${list.length} ${list.length === 1 ? 'προσφορά' : 'προσφορές'} · ${formatEuro(summaryTotal)}`}
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => {
            const customerName = item.customerId ? names[item.customerId] : undefined;
            return (
              <Pressable
                onPress={() => setSelectedId(item.id)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <View style={styles.body}>
                  <ThemedText type="smallBold" numberOfLines={1}>{item.offerNumber}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {[customerName, STATUS_LABEL[item.status] ?? item.status].filter(Boolean).join(' · ')}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" style={styles.amount}>{formatEuro(item.total)}</ThemedText>
                <Ionicons name="chevron-forward" size={16} color="#9AA4B2" />
              </Pressable>
            );
          }}
        />
      )}

      <OfferPreviewSheet
        offerId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => void load()}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerSafe: { borderBottomWidth: 1, borderBottomColor: '#EEF1F5', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: 4 },
  back: { padding: 4 },
  title: { fontSize: 22 },
  tabsWrap: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.two, paddingTop: Spacing.one },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: BottomTabInset + Spacing.four },
  summary: { paddingBottom: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, backgroundColor: '#F7F9FB', borderRadius: 14, padding: Spacing.three, marginBottom: Spacing.two },
  body: { flex: 1, gap: 2 },
  amount: { color: '#0A1120' },
  pressed: { opacity: 0.6 },
});
