// Πελάτες — searchable list with status filter chips (mirrors the web list).

import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Input, PrimaryButton, SheetModal } from '@/components/ui';
import { BottomTabInset, Brand, BrandGradient, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPost } from '@/lib/api';
import type { Customer } from '@/lib/types';

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: '', label: 'Όλοι' },
  // «Αναμονή στοιχείων» (#8): inbound-call contacts auto-created without a name.
  { key: 'awaiting', label: 'Αναμονή στοιχείων' },
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
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const [items, setItems] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  // #9 — phone-imported contacts are HIDDEN BY DEFAULT (owner request: app
  // contacts only); a toggle reveals them.
  const [hideImported, setHideImported] = useState(true);
  // U7 parity — alphabetical is the DEFAULT (owner request). Ref so `load`
  // (dep-free) reads the current value without re-creating the callback.
  const [sortByName, setSortByName] = useState(true);
  const sortByNameRef = useRef(true);
  const [addOpen, setAddOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence guard: a slow response for «γ» must not overwrite «γιάννης».
  const loadSeq = useRef(0);

  const load = useCallback(async (query: string, st: string) => {
    setError(null);
    const seq = ++loadSeq.current;
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (query.trim()) params.set('q', query.trim());
      // 'awaiting' is a derived pseudo-filter (#8), not a real status value.
      if (st === 'awaiting') params.set('awaiting', '1');
      else if (st) params.set('status', st);
      if (sortByNameRef.current) params.set('sort', 'name');
      const json = await apiGet<{ ok?: boolean; customers?: Customer[] }>(
        `/api/customers?${params.toString()}`,
      );
      if (seq !== loadSeq.current) return;
      if (json && Array.isArray(json.customers)) setItems(json.customers);
      else setError('Δεν φόρτωσαν οι πελάτες.');
    } catch {
      if (seq !== loadSeq.current) return;
      setError('Σφάλμα σύνδεσης με τον server.');
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false);
        setRefreshing(false);
      }
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

  function onToggleSort() {
    const next = !sortByNameRef.current;
    sortByNameRef.current = next;
    setSortByName(next);
    setLoading(true);
    void load(q, status);
  }

  const [importing, setImporting] = useState(false);
  const phoneKey = (p?: string | null) => (p ? p.replace(/\D/g, '').slice(-10) : '');

  async function importContacts() {
    if (importing) return;
    const { status: perm } = await Contacts.requestPermissionsAsync();
    if (perm !== 'granted') {
      Alert.alert('Επαφές', 'Χρειάζεται άδεια πρόσβασης στις επαφές για την εισαγωγή.');
      return;
    }
    setImporting(true);
    try {
      const { data: contacts } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails, Contacts.Fields.Company],
      });
      // Dedup against existing customers (server caps at 100; good enough on first run).
      const existing = new Set<string>();
      try {
        const res = await apiGet<{ customers?: Customer[] }>('/api/customers?limit=100');
        for (const c of res?.customers ?? []) {
          [c.mobilePhone, c.phone, c.landlinePhone].forEach((p) => { const k = phoneKey(p); if (k) existing.add(k); });
        }
      } catch {
        // proceed without dedup
      }

      const candidates = contacts
        .map((c) => {
          const phone = c.phoneNumbers?.[0]?.number ?? null;
          return {
            name: c.name?.trim() || null,
            companyName: c.company?.trim() || null,
            mobilePhone: phone,
            email: c.emails?.[0]?.email?.trim() || null,
          };
        })
        .filter((c) => (c.name || c.companyName) && c.mobilePhone && !existing.has(phoneKey(c.mobilePhone)));

      if (candidates.length === 0) {
        Alert.alert('Εισαγωγή επαφών', 'Δεν βρέθηκαν νέες επαφές με τηλέφωνο για εισαγωγή.');
        return;
      }

      let added = 0;
      for (const c of candidates.slice(0, 500)) {
        try {
          const r = await apiPost<{ ok?: boolean }>('/api/customers', { ...c, source: 'manual_entry', importedFromPhone: true });
          if (r?.ok) added += 1;
        } catch {
          // skip failures, keep going
        }
      }
      Alert.alert('✓', `Εισήχθησαν ${added} ${added === 1 ? 'πελάτης' : 'πελάτες'} από τις επαφές.`);
      void load(q, status);
    } catch {
      Alert.alert('Σφάλμα', 'Η εισαγωγή απέτυχε.');
    } finally {
      setImporting(false);
    }
  }

  const visibleItems = useMemo(
    () => (hideImported ? items.filter((i) => !i.importedFromPhone) : items),
    [items, hideImported],
  );
  const hasImported = useMemo(() => items.some((i) => i.importedFromPhone), [items]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.titleRow}>
          <ThemedText type="subtitle" style={styles.title}>
            Πελάτες
          </ThemedText>
          <View style={styles.titleActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Εισαγωγή από επαφές"
              onPress={() => void importContacts()}
              disabled={importing}
              style={({ pressed }) => [styles.importBtn, (pressed || importing) && styles.rowPressed]}>
              {importing ? <ActivityIndicator size="small" color={Brand.primary} /> : <Ionicons name="cloud-download-outline" size={20} color={Brand.primary} />}
            </Pressable>
            {/* Walk-up / referral customers get saved on the spot — no laptop detour. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Νέος πελάτης"
              onPress={() => setAddOpen(true)}
              style={({ pressed }) => [styles.addBtn, pressed && styles.rowPressed]}>
              <Ionicons name="add" size={24} color={Brand.onPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={c.textFaint} />
          <TextInput
            value={q}
            onChangeText={onSearch}
            placeholder="Αναζήτηση (όνομα, τηλέφωνο, email)"
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {q ? (
            <Pressable onPress={() => onSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={c.textFaint} />
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

        {/* Sort (U7 parity) + hide phone-imported (#9, only when relevant). */}
        <View style={styles.toolbar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Ταξινόμηση" onPress={onToggleSort} style={styles.sortToggle} hitSlop={6}>
            <Ionicons name="swap-vertical" size={16} color={Brand.primary} />
            <ThemedText type="small">{sortByName ? 'Αλφαβητικά' : 'Πρόσφατοι'}</ThemedText>
          </Pressable>
          {hasImported ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: hideImported }}
              onPress={() => setHideImported((v) => !v)}
              style={styles.sortToggle}
              hitSlop={6}>
              <Ionicons
                name={hideImported ? 'checkbox' : 'square-outline'}
                size={16}
                color={hideImported ? Brand.primary : c.textFaint}
              />
              <ThemedText type="small" themeColor={hideImported ? undefined : 'textSecondary'}>
                Απόκρυψη επαφών κινητού
              </ThemedText>
            </Pressable>
          ) : null}
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
        ) : visibleItems.length === 0 ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">
              {q || status || hideImported ? 'Κανένα αποτέλεσμα.' : 'Δεν υπάρχουν πελάτες ακόμα.'}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={visibleItems}
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
                  style={({ pressed }) => [styles.rowOuter, pressed && styles.rowPressed]}>
                  <View style={styles.row}>
                    <LinearGradient colors={[...BrandGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.avatar}>
                      <ThemedText style={styles.avatarText}>
                        {(item.name ?? 'Π').trim().slice(0, 1).toUpperCase()}
                      </ThemedText>
                      {dot ? <View style={[styles.statusDot, { backgroundColor: dot }]} /> : null}
                    </LinearGradient>
                    <View style={styles.rowText}>
                      <ThemedText type="smallBold">{item.name || phone || 'Πελάτης'}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {item.name
                          ? [item.companyName, phone].filter(Boolean).join(' · ') || '—'
                          : 'Αναμονή στοιχείων'}
                      </ThemedText>
                      {item.needsIntake ? (
                        <View style={styles.needsChip}>
                          <ThemedText style={styles.needsChipText}>Λείπουν στοιχεία</ThemedText>
                        </View>
                      ) : null}
                    </View>
                    {item.address ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Πλοήγηση"
                        onPress={() =>
                          void Linking.openURL(
                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address ?? '')}`,
                          )
                        }
                        hitSlop={8}
                        style={({ pressed }) => [styles.mapsBtn, pressed && styles.rowPressed]}>
                        <Ionicons name="navigate" size={16} color={Brand.primary} />
                      </Pressable>
                    ) : null}
                    {item.pinned ? <Ionicons name="bookmark" size={15} color={Brand.primary} /> : null}
                    <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
                  </View>
                  {item.nextBestAction ? (
                    <View style={styles.nextAction}>
                      <Ionicons name="sparkles" size={13} color={Brand.primary} />
                      <ThemedText type="small" numberOfLines={2} style={styles.nextActionText}>
                        {item.nextBestAction}
                      </ThemedText>
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>

      <AddCustomerSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          setAddOpen(false);
          void load(q, status);
          router.push({ pathname: '/customers/[id]', params: { id } });
        }}
      />
    </ThemedView>
  );
}

// «Νέος πελάτης» — minimal on-site form (name/company + phone are enough while
// standing in the customer's kitchen; everything else can be edited later).
function AddCustomerSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setCompany('');
      setMobile('');
      setEmail('');
    }
  }, [visible]);

  async function create() {
    if (!name.trim() && !company.trim()) {
      Alert.alert('Νέος πελάτης', 'Συμπλήρωσε όνομα ή εταιρεία.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; customer?: { id: string } }>('/api/customers', {
        name: name.trim() || null,
        companyName: company.trim() || null,
        mobilePhone: mobile.trim() || null,
        email: email.trim() || null,
        source: 'manual_entry',
      });
      if (res?.customer?.id) onCreated(res.customer.id);
      else Alert.alert('Σφάλμα', 'Ο πελάτης δεν δημιουργήθηκε.');
    } catch {
      Alert.alert('Σφάλμα', 'Ο πελάτης δεν δημιουργήθηκε.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} title="Νέος πελάτης" onClose={onClose}>
      <Input label="Ονοματεπώνυμο" value={name} onChangeText={setName} />
      <Input label="Εταιρεία (προαιρετικό)" value={company} onChangeText={setCompany} />
      <Input label="Κινητό" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
      <Input label="Email (προαιρετικό)" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <PrimaryButton label="Δημιουργία" onPress={() => void create()} busy={busy} />
    </SheetModal>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: Spacing.four,
  },
  title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.two },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.three },
  importBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    paddingHorizontal: Spacing.three,
    height: 44,
    borderRadius: 12,
    backgroundColor: c.surface,
  },
  searchInput: { flex: 1, fontSize: 16, color: c.text, paddingVertical: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  chip: { paddingHorizontal: Spacing.three, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: c.border },
  chipActive: { backgroundColor: Brand.primary, borderColor: Brand.primary },
  chipActiveText: { color: Brand.onPrimary, fontWeight: '700' },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingBottom: Spacing.two },
  sortToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four },
  centerText: { textAlign: 'center' },
  list: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four },
  sep: { height: 1, backgroundColor: c.border, marginLeft: 52 },
  rowOuter: { paddingVertical: Spacing.three },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  rowPressed: { opacity: 0.6 },
  rowText: { flex: 1, gap: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  mapsBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  nextAction: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: Spacing.two, marginLeft: 52, backgroundColor: Brand.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  nextActionText: { flex: 1, color: Brand.navy },
  needsChip: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: '#FBE9C7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  needsChipText: { color: '#9A6200', fontSize: 11, fontWeight: '700' },
  statusDot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: c.card },
  retry: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: 12, backgroundColor: Brand.primary },
  retryText: { color: Brand.onPrimary, fontWeight: '700' },
});
