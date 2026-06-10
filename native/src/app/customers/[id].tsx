import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Brand, Spacing } from '@/constants/theme';
import { apiGet } from '@/lib/api';

interface Customer {
  id: string;
  name: string | null;
  companyName?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  landlinePhone?: string | null;
  email?: string | null;
  address?: string | null;
  status?: string | null;
  opportunityValue?: number | null;
  notes?: string | null;
  needsSummary?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Νέος',
  in_progress: 'Σε εξέλιξη',
  won: 'Κερδισμένος',
  lost: 'Χαμένος',
};

export default function CustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const json = await apiGet<{ ok?: boolean; customer?: Customer }>(`/api/customers/${id}`);
      if (json?.customer) setCustomer(json.customer);
      else setError('Δεν βρέθηκε ο πελάτης.');
    } catch {
      setError('Σφάλμα σύνδεσης.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const callPhone = customer?.mobilePhone || customer?.landlinePhone || customer?.phone || '';

  if (loading) {
    return (
      <ThemedView style={styles.fill}>
        <View style={styles.center}><ActivityIndicator color={Brand.primary} /></View>
      </ThemedView>
    );
  }
  if (error || !customer) {
    return (
      <ThemedView style={styles.fill}>
        <View style={styles.center}>
          <ThemedText themeColor="textSecondary">{error ?? 'Σφάλμα.'}</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ title: customer.name ?? 'Πελάτης' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.avatar}>
            <ThemedText style={styles.avatarText}>
              {(customer.name ?? 'Π').trim().slice(0, 1).toUpperCase()}
            </ThemedText>
          </View>
          <ThemedText type="subtitle" style={styles.name}>{customer.name ?? 'Πελάτης'}</ThemedText>
          {customer.companyName ? (
            <ThemedText type="small" themeColor="textSecondary">{customer.companyName}</ThemedText>
          ) : null}
          {customer.status ? (
            <View style={styles.badge}>
              <ThemedText style={styles.badgeText}>
                {STATUS_LABELS[customer.status] ?? customer.status}
              </ThemedText>
            </View>
          ) : null}
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          <ActionButton
            label="Κλήση"
            disabled={!callPhone}
            onPress={() => callPhone && Linking.openURL(`tel:${callPhone}`)}
          />
          <ActionButton
            label="Μήνυμα"
            disabled={!callPhone}
            onPress={() => callPhone && Linking.openURL(`sms:${callPhone}`)}
          />
        </View>

        {/* Contact card */}
        <ThemedView type="backgroundElement" style={styles.card}>
          <Field label="Κινητό" value={customer.mobilePhone} />
          <Field label="Σταθερό" value={customer.landlinePhone} />
          <Field label="Τηλέφωνο" value={customer.phone} />
          <Field label="Email" value={customer.email} />
          <Field label="Διεύθυνση" value={customer.address} />
          {customer.address ? (
            <Pressable
              onPress={() =>
                Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(customer.address ?? '')}`,
                )
              }
              style={({ pressed }) => [styles.mapsBtn, pressed && styles.pressed]}>
              <ThemedText style={styles.mapsText}>Άνοιγμα στο Google Maps</ThemedText>
            </Pressable>
          ) : null}
          {typeof customer.opportunityValue === 'number' && customer.opportunityValue > 0 ? (
            <Field label="Αξία ευκαιρίας" value={`${customer.opportunityValue} €`} />
          ) : null}
        </ThemedView>

        {/* Notes */}
        {customer.needsSummary || customer.notes ? (
          <ThemedView type="backgroundElement" style={styles.card}>
            {customer.needsSummary ? (
              <View style={styles.noteBlock}>
                <ThemedText type="smallBold">Ανάγκες</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{customer.needsSummary}</ThemedText>
              </View>
            ) : null}
            {customer.notes ? (
              <View style={styles.noteBlock}>
                <ThemedText type="smallBold">Σημειώσεις</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{customer.notes}</ThemedText>
              </View>
            ) : null}
          </ThemedView>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.field}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.fieldLabel}>{label}</ThemedText>
      <ThemedText type="small" style={styles.fieldValue}>{value}</ThemedText>
    </View>
  );
}

function ActionButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, disabled && styles.actionDisabled, pressed && styles.pressed]}>
      <ThemedText style={styles.actionText}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.four, gap: Spacing.four },
  hero: { alignItems: 'center', gap: Spacing.two },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Brand.primary, fontSize: 30, fontWeight: '700' },
  name: { textAlign: 'center' },
  badge: { backgroundColor: Brand.primarySoft, paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999, marginTop: 4 },
  badgeText: { color: Brand.primary, fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: Spacing.three },
  action: { flex: 1, height: 48, borderRadius: 14, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  actionDisabled: { opacity: 0.4 },
  actionText: { color: Brand.onPrimary, fontWeight: '700', fontSize: 15 },
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.three },
  field: { gap: 2 },
  fieldLabel: {},
  fieldValue: { fontSize: 15 },
  mapsBtn: { paddingVertical: Spacing.two },
  mapsText: { color: Brand.primary, fontWeight: '700' },
  noteBlock: { gap: 4 },
  pressed: { opacity: 0.6 },
});
