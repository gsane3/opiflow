// Καθολική αναζήτηση — native parity with the web search page. A debounced,
// request-sequence-guarded input that queries customers (server-side), then
// client-filters offers (by offerNumber) and open tasks (by title). Grouped
// results: tap a customer/task → open the customer; tap an offer → preview sheet.

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OfferPreviewSheet } from '@/components/offer-preview-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ListRow, Section } from '@/components/ui';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiGet } from '@/lib/api';
import type { Customer, Offer, Task } from '@/lib/types';

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'gu');

/** Greek-aware fold: lowercase + strip accents, so «Γιώργος» matches «γιωργος». */
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(DIACRITICS, '');
}

const MAX_PER_GROUP = 8;

interface Results {
  customers: Customer[];
  offers: Offer[];
  tasks: Task[];
}

const EMPTY: Results = { customers: [], offers: [], tasks: [] };

export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [previewOfferId, setPreviewOfferId] = useState<string | null>(null);

  const inputRef = useRef<TextInput | null>(null);
  // Monotonic request id — only the latest in-flight search may write state, so
  // a slow earlier request can't clobber the results of a faster later one.
  const reqId = useRef(0);

  // Debounce the raw input (~300ms) before it drives a network round-trip.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const run = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    const id = ++reqId.current;
    if (!trimmed) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = norm(trimmed);
    try {
      const [c, o, t] = await Promise.all([
        apiGet<{ customers?: Customer[] }>(`/api/customers?q=${encodeURIComponent(trimmed)}&limit=20`),
        apiGet<{ offers?: Offer[] }>('/api/offers?limit=100'),
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=open&limit=100'),
      ]);
      // A newer keystroke already superseded us — drop this stale response.
      if (id !== reqId.current) return;
      const customers = (c?.customers ?? []).slice(0, MAX_PER_GROUP);
      const offers = (o?.offers ?? [])
        .filter((of) => of.offerNumber && norm(of.offerNumber).includes(q))
        .slice(0, MAX_PER_GROUP);
      const tasks = (t?.tasks ?? [])
        .filter((tk) => tk.title && norm(tk.title).includes(q))
        .slice(0, MAX_PER_GROUP);
      setResults({ customers, offers, tasks });
    } catch {
      if (id === reqId.current) setResults(EMPTY);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void run(debounced); }, [debounced, run]);

  // Names for offer/task customer subtitles.
  const customerName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of results.customers) map[c.id] = c.name ?? 'Πελάτης';
    return map;
  }, [results.customers]);

  const hasQuery = debounced.trim().length > 0;
  const total = results.customers.length + results.offers.length + results.tasks.length;

  const openCustomer = (id: string) => router.push({ pathname: '/customers/[id]', params: { id } });

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={28} color={Brand.primary} />
          </Pressable>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color="#9AA4B2" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              autoFocus
              placeholder="Πελάτες, προσφορές, εργασίες…"
              placeholderTextColor="#9AA4B2"
              returnKeyType="search"
              autoCorrect={false}
              style={styles.input}
            />
            {query ? (
              <Pressable onPress={() => { setQuery(''); inputRef.current?.focus(); }} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color="#9AA4B2" />
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>

      {loading && total === 0 ? (
        <View style={styles.center}><ActivityIndicator color={Brand.primary} /></View>
      ) : !hasQuery ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Ξεκίνα να πληκτρολογείς για αναζήτηση σε πελάτες, προσφορές και εργασίες.
          </ThemedText>
        </View>
      ) : total === 0 ? (
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            Κανένα αποτέλεσμα για «{debounced.trim()}».
          </ThemedText>
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}>
          <View style={styles.groups}>
            {results.customers.length > 0 ? (
              <Section title="Πελάτες" count={results.customers.length} initiallyOpen>
                {results.customers.map((c) => (
                  <ListRow
                    key={c.id}
                    title={c.name ?? 'Πελάτης'}
                    subtitle={c.phone ?? c.mobilePhone ?? c.email ?? c.companyName ?? undefined}
                    onPress={() => openCustomer(c.id)}
                  />
                ))}
              </Section>
            ) : null}

            {results.offers.length > 0 ? (
              <Section title="Προσφορές" count={results.offers.length} initiallyOpen>
                {results.offers.map((o) => (
                  <ListRow
                    key={o.id}
                    title={o.offerNumber}
                    subtitle={o.customerId ? customerName[o.customerId] : undefined}
                    onPress={() => setPreviewOfferId(o.id)}
                  />
                ))}
              </Section>
            ) : null}

            {results.tasks.length > 0 ? (
              <Section title="Εργασίες" count={results.tasks.length} initiallyOpen>
                {results.tasks.map((t) => (
                  <ListRow
                    key={t.id}
                    title={t.title}
                    subtitle={t.customerId ? customerName[t.customerId] : undefined}
                    onPress={() => t.customerId && openCustomer(t.customerId)}
                  />
                ))}
              </Section>
            ) : null}
          </View>
        </ScrollView>
      )}

      <OfferPreviewSheet offerId={previewOfferId} onClose={() => setPreviewOfferId(null)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerSafe: { borderBottomWidth: 1, borderBottomColor: '#EEF1F5', backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingTop: 4, paddingBottom: Spacing.two },
  back: { padding: 4 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: '#F4F6F9',
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    height: 44,
  },
  input: { flex: 1, fontSize: 16, color: '#0A1120', paddingVertical: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  centerText: { textAlign: 'center' },
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.three, paddingBottom: BottomTabInset + Spacing.four },
  groups: { gap: Spacing.three },
});
