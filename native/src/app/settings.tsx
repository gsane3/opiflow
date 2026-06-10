// Ρυθμίσεις — web parity sections: Επιχείρηση (businesses/me), Τηλεφωνία,
// Κατάλογος υπηρεσιών (/api/catalog CRUD), Λογαριασμός. Data/Ειδοποιήσεις → web.

import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Input, ListRow, PrimaryButton, Section } from '@/components/ui';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatEuro } from '@/lib/format';
import { getIncomingState } from '@/lib/twilio-state';
import type { Business, CatalogItem } from '@/lib/types';

const PHONE_LABEL: Record<string, string> = {
  idle: 'Μη συνδεδεμένο',
  registering: 'Σύνδεση…',
  registered: 'Συνδεδεμένο ✓',
  error: 'Σφάλμα',
};

export default function SettingsScreen() {
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? '';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const [phone, setPhone] = useState(getIncomingState());
  useEffect(() => {
    const t = setInterval(() => setPhone(getIncomingState()), 1500);
    return () => clearInterval(t);
  }, []);
  const phoneValue = phone.state === 'error' ? `Σφάλμα: ${phone.detail ?? ''}` : PHONE_LABEL[phone.state];

  // ----- business profile -----
  const [biz, setBiz] = useState<Business | null>(null);
  const [bizForm, setBizForm] = useState<Record<string, string>>({});
  const [bizBusy, setBizBusy] = useState(false);

  // ----- catalog -----
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catName, setCatName] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catUnit, setCatUnit] = useState('');
  const [catPrice, setCatPrice] = useState('');
  const [catVat, setCatVat] = useState('24');
  const [catBusy, setCatBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, c] = await Promise.all([
        apiGet<{ ok?: boolean; business?: Business }>('/api/businesses/me'),
        apiGet<{ ok?: boolean; items?: CatalogItem[] }>('/api/catalog'),
      ]);
      if (b?.business) {
        setBiz(b.business);
        setBizForm({
          name: b.business.name ?? '',
          phone: b.business.phone ?? '',
          email: b.business.email ?? '',
          address: b.business.address ?? '',
          city: b.business.city ?? '',
          vat_number: b.business.vat_number ?? '',
          tax_office: b.business.tax_office ?? '',
          default_vat_rate: b.business.default_vat_rate != null ? String(b.business.default_vat_rate) : '24',
          default_offer_terms: b.business.default_offer_terms ?? '',
        });
      }
      setCatalog(c?.items ?? []);
    } catch {
      // sections show empty states; pull of the screen retries on remount
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setB = (k: string) => (v: string) => setBizForm((f) => ({ ...f, [k]: v }));

  async function saveBusiness() {
    setBizBusy(true);
    try {
      const vat = parseFloat((bizForm.default_vat_rate ?? '24').replace(',', '.'));
      const res = await apiPatch<{ ok?: boolean }>('/api/businesses/me', {
        name: bizForm.name || null,
        phone: bizForm.phone || null,
        email: bizForm.email || null,
        address: bizForm.address || null,
        city: bizForm.city || null,
        vat_number: bizForm.vat_number || null,
        tax_office: bizForm.tax_office || null,
        default_vat_rate: Number.isFinite(vat) ? vat : 24,
        default_offer_terms: bizForm.default_offer_terms || null,
      });
      if (res?.ok) Alert.alert('✓', 'Αποθηκεύτηκε.');
      else Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setBizBusy(false);
    }
  }

  async function addCatalogItem() {
    if (!catName.trim()) {
      Alert.alert('Κατάλογος', 'Συμπλήρωσε όνομα υπηρεσίας/υλικού.');
      return;
    }
    setCatBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; item?: CatalogItem; error?: string }>('/api/catalog', {
        name: catName.trim(),
        code: catCode.trim() || null,
        unit: catUnit.trim() || null,
        unitPrice: parseFloat(catPrice.replace(',', '.')) || 0,
        vatRate: parseFloat(catVat.replace(',', '.')) || 24,
      });
      if (res?.ok) {
        setCatName('');
        setCatCode('');
        setCatUnit('');
        setCatPrice('');
        void load();
      } else {
        Alert.alert('Σφάλμα', res?.error === 'duplicate_code' ? 'Υπάρχει ήδη είδος με αυτόν τον κωδικό.' : 'Η προσθήκη απέτυχε.');
      }
    } catch {
      Alert.alert('Σφάλμα', 'Η προσθήκη απέτυχε.');
    } finally {
      setCatBusy(false);
    }
  }

  function deleteCatalogItem(item: CatalogItem) {
    Alert.alert('Διαγραφή', `Διαγραφή «${item.name}»;`, [
      { text: 'Ακύρωση', style: 'cancel' },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: async () => {
          setCatalog((c) => c.filter((x) => x.id !== item.id));
          try {
            await apiDelete(`/api/catalog/${item.id}`);
          } catch {
            void load();
          }
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ThemedText type="subtitle" style={styles.title}>
          Ρυθμίσεις
        </ThemedText>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Λογαριασμός header */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <ThemedText style={styles.avatarText}>{(email || 'O').slice(0, 1).toUpperCase()}</ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{biz?.name ?? 'Λογαριασμός'}</ThemedText>
                {email ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {email}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          </ThemedView>

          {/* Τηλεφωνία */}
          <Section title="Τηλεφωνία" initiallyOpen>
            <Row label="Ο αριθμός σου" value={biz?.business_phone_number ?? '—'} />
            <Row label="Τηλέφωνο app (εισερχόμενες)" value={phoneValue} />
            <PrimaryButton
              label="Επανασύνδεση τηλεφώνου"
              tone="outline"
              onPress={async () => {
                const { registerForIncoming } = await import('@/lib/twilio');
                void registerForIncoming();
              }}
            />
          </Section>

          {/* Επιχείρηση */}
          <Section title="Επιχείρηση">
            <Input label="Όνομα επιχείρησης" value={bizForm.name ?? ''} onChangeText={setB('name')} />
            <Input label="Τηλέφωνο" value={bizForm.phone ?? ''} onChangeText={setB('phone')} keyboardType="phone-pad" />
            <Input label="Email" value={bizForm.email ?? ''} onChangeText={setB('email')} keyboardType="email-address" />
            <Input label="Διεύθυνση" value={bizForm.address ?? ''} onChangeText={setB('address')} />
            <Input label="Πόλη" value={bizForm.city ?? ''} onChangeText={setB('city')} />
            <Input label="ΑΦΜ" value={bizForm.vat_number ?? ''} onChangeText={setB('vat_number')} />
            <Input label="Δ.Ο.Υ." value={bizForm.tax_office ?? ''} onChangeText={setB('tax_office')} />
            <Input label="ΦΠΑ % (προεπιλογή)" value={bizForm.default_vat_rate ?? ''} onChangeText={setB('default_vat_rate')} keyboardType="decimal-pad" />
            <Input label="Όροι προσφοράς (προεπιλογή)" value={bizForm.default_offer_terms ?? ''} onChangeText={setB('default_offer_terms')} multiline />
            <PrimaryButton label="Αποθήκευση" onPress={() => void saveBusiness()} busy={bizBusy} />
          </Section>

          {/* Κατάλογος υπηρεσιών */}
          <Section title="Κατάλογος υπηρεσιών" count={catalog.length}>
            {catalog.map((it) => (
              <ListRow
                key={it.id}
                title={`${it.code ? `${it.code} · ` : ''}${it.name}`}
                subtitle={`${formatEuro(it.unitPrice)}${it.unit ? ` / ${it.unit}` : ''} · ΦΠΑ ${it.vatRate}%`}
                onPress={() => deleteCatalogItem(it)}
              />
            ))}
            <ThemedText type="smallBold" style={styles.subhead}>
              Προσθήκη είδους
            </ThemedText>
            <Input label="Όνομα υπηρεσίας/υλικού" value={catName} onChangeText={setCatName} />
            <View style={styles.catRow}>
              <View style={styles.catCol}>
                <Input label="Κωδ." value={catCode} onChangeText={setCatCode} />
              </View>
              <View style={styles.catCol}>
                <Input label="Μον." value={catUnit} onChangeText={setCatUnit} placeholder="τεμ." />
              </View>
              <View style={styles.catCol}>
                <Input label="€" value={catPrice} onChangeText={setCatPrice} keyboardType="decimal-pad" />
              </View>
              <View style={styles.catCol}>
                <Input label="ΦΠΑ%" value={catVat} onChangeText={setCatVat} keyboardType="decimal-pad" />
              </View>
            </View>
            <PrimaryButton label="Προσθήκη" onPress={() => void addCatalogItem()} busy={catBusy} />
            <ThemedText type="small" themeColor="textSecondary">
              Tip: πάτησε ένα είδος για διαγραφή. Ο κατάλογος τροφοδοτεί τις προτάσεις στη «Νέα προσφορά».
            </ThemedText>
          </Section>

          {/* Δεδομένα / Ειδοποιήσεις hint */}
          <Section title="Δεδομένα & Ειδοποιήσεις">
            <ThemedText type="small" themeColor="textSecondary">
              Εισαγωγή/εξαγωγή πελατών (CSV), ομάδα και ρυθμίσεις ειδοποιήσεων γίνονται από το web:
              www.opiflow.ai → Ρυθμίσεις.
            </ThemedText>
          </Section>

          {/* Λογαριασμός */}
          <Section title="Λογαριασμός">
            <Row label="Email" value={email || '—'} />
            <Row label="Έκδοση εφαρμογής" value={version} />
          </Section>

          <Pressable onPress={signOut} style={({ pressed }) => [styles.signout, pressed && styles.pressed]}>
            <Ionicons name="log-out-outline" size={18} color="#D14343" />
            <ThemedText style={styles.signoutText}>Αποσύνδεση</ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.rowValue} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.three },
  content: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: 16 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Brand.primary, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, paddingVertical: 6 },
  rowValue: { flexShrink: 1 },
  subhead: { marginTop: Spacing.two },
  catRow: { flexDirection: 'row', gap: Spacing.two },
  catCol: { flex: 1 },
  signout: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3B7B7',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  signoutText: { color: '#D14343', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
