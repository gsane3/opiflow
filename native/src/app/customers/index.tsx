import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiGet } from '@/lib/api';

interface Customer {
  id: string;
  name: string | null;
  mobilePhone?: string | null;
  phone?: string | null;
  landlinePhone?: string | null;
}

export default function CustomersListScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const json = await apiGet<{ ok?: boolean; customers?: Customer[] }>('/api/customers?limit=200');
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
    void load();
  }, [load]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ThemedText type="subtitle" style={styles.title}>
          Πελάτες
        </ThemedText>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Brand.primary} />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary" style={styles.centerText}>
              {error}
            </ThemedText>
            <Pressable onPress={() => { setLoading(true); void load(); }} style={styles.retry}>
              <ThemedText style={styles.retryText}>Δοκίμασε ξανά</ThemedText>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">Δεν υπάρχουν πελάτες ακόμα.</ThemedText>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); void load(); }}
                tintColor={Brand.primary}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => {
              const phone = item.mobilePhone || item.landlinePhone || item.phone || '';
              return (
                <Pressable
                  onPress={() => router.push({ pathname: '/customers/[id]', params: { id: item.id } })}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                  <View style={styles.avatar}>
                    <ThemedText style={styles.avatarText}>
                      {(item.name ?? 'Π').trim().slice(0, 1).toUpperCase()}
                    </ThemedText>
                  </View>
                  <View style={styles.rowText}>
                    <ThemedText type="smallBold">{item.name ?? 'Πελάτης'}</ThemedText>
                    {phone ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {phone}
                      </ThemedText>
                    ) : null}
                  </View>
                  <ThemedText type="default" themeColor="textSecondary" style={styles.chevron}>
                    ›
                  </ThemedText>
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
  title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.three },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  centerText: { textAlign: 'center' },
  list: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  sep: { height: 1, backgroundColor: '#EEF1F5', marginLeft: 52 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Brand.primary, fontSize: 16, fontWeight: '700' },
  chevron: { fontSize: 22 },
  retry: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: 12, backgroundColor: Brand.primary },
  retryText: { color: Brand.onPrimary, fontWeight: '700' },
});
