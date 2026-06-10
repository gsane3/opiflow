// Πελάτες — searchable list with status filter chips (mirrors the web list).

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiGet } from '@/lib/api';
import type { Customer } from '@/lib/types';

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Όλοι' },
  { key: 'new', label: 'Νέοι' },
  { key: 'in_progress', label: 'Σε εξέλιξη' },
  { key: 'won', label: 'Κερδισμένοι' },
  { key: 'lost', label: 'Χαμένοι' },
];

const STATUS_DOT: Record<string, string> = {
  new: '#3361FF',
  in_progress: '#B7791F',
  won: '#1B8A4C',
  lost: '#9AA4B2',
};

export default function CustomersListScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (query: string, st: string) => {
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (query.trim()) params.set('q', query.trim());
      if (st) params.set('status', st);
      const json = await apiGet<{ ok?: boolean; customers?: Customer[] }>(
        `/api/customers?${params.toString()}`,
      );
      if (json && Array.isArray(json.customers)) setItems(json.customers);
      else setError('Δεν φόρτωσαν οι πελάτες.');
    } catch {
      setError('Σφάλμα σύνδεσης με τον server.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('', '');
  }, [load]);

  function onSearch(text: string) {
    setQ(text);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void load(text, status), 350);
  }

  function onStatus(st: string) {
    setStatus(st);
    setLoading(true);
    void load(q, st);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ThemedText type="subtitle" style={styles.title}>
          Πελάτες
        </ThemedText>

        {/* Search */}
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color="#9AA4B2" />
          <TextInput
            value={q}
            onChangeText={onSearch}
            placeholder="Αναζήτηση (όνομα, τηλέφωνο, email)"
            placeholderTextColor="#9AA4B2"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {q ? (
            <Pressable onPress={() => onSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color="#9AA4B2" />
            </Pressable>
          ) : null}
        </View>

        {/* Status chips */}
        <View style={styles.chips}>
          {STATUS_FILTERS.map((f) => (
            <Pressable
              key={f.key}
              onPress={() => onStatus(f.key)}
              style={[styles.chip, status === f.key && styles.chipActive]}>
              <ThemedText type="small" style={status === f.key ? styles.chipActiveText : undefined}>
                {f.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Brand.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary" style={styles.centerText}>
              {error}
            </ThemedText>
            <Pressable
              onPress={() => {
                setLoading(true);
                void load(q, status);
              }}
              style={styles.retry}>
              <ThemedText style={styles.retryText}>Δοκίμασε ξανά</ThemedText>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">
              {q || status ? 'Κανένα αποτέλεσμα.' : 'Δεν υπάρχουν πελάτες ακόμα.'}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void load(q, status);
                }}
                tintColor={Brand.primary}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => {
              const phone = item.mobilePhone || item.landlinePhone || item.phone || '';
              const dot = item.status ? STATUS_DOT[item.status] : undefined;
              return (
                <Pressable
                  onPress={() => router.push({ pathname: '/customers/[id]', params: { id: item.id } })}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                  <View style={styles.avatar}>
                    <ThemedText style={styles.avatarText}>
                      {(item.name ?? 'Π').trim().slice(0, 1).toUpperCase()}
                    </ThemedText>
                    {dot ? <View style={[styles.statusDot, { backgroundColor: dot }]} /> : null}
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold">{item.name ?? 'Πελάτης'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {[item.companyName, phone].filter(Boolean).join(' · ') || '—'}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#9AA4B2" />
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.two },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    paddingHorizontal: Spacing.three,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F2F4F7',
  },
  searchInput: { flex: 1, fontSize: 16, color: '#0A1120', paddingVertical: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#D8DEE6' },
  chipActive: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  chipActiveText: { color: Brand.onPrimary, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  centerText: { textAlign: 'center' },
  list: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  sep: { height: 1, backgroundColor: '#EEF1F5', marginLeft: 52 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Brand.primary, fontSize: 16, fontWeight: '700' },
  statusDot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#FFFFFF' },
  retry: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: 12, backgroundColor: Brand.primary },
  retryText: { color: Brand.onPrimary, fontWeight: '700' },
});
