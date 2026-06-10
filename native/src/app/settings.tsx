import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';
import { getIncomingState } from '@/lib/twilio-state';

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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ThemedText type="subtitle" style={styles.title}>
          Ρυθμίσεις
        </ThemedText>

        <ScrollView contentContainerStyle={styles.content}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <ThemedText style={styles.avatarText}>
                  {(email || 'O').slice(0, 1).toUpperCase()}
                </ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Λογαριασμός</ThemedText>
                {email ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {email}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <Row label="Τηλέφωνο (εισερχόμενες)" value={phoneValue} />
            <View style={styles.divider} />
            <Row label="Έκδοση" value={version} />
          </ThemedView>

          <Pressable
            onPress={async () => {
              const { registerForIncoming } = await import('@/lib/twilio'); // lazy — loads SDK on tap
              void registerForIncoming();
            }}
            style={({ pressed }) => [styles.connect, pressed && styles.pressed]}>
            <ThemedText style={styles.connectText}>Σύνδεση τηλεφώνου (εισερχόμενες)</ThemedText>
          </Pressable>

          <Pressable
            onPress={signOut}
            style={({ pressed }) => [styles.signout, pressed && styles.pressed]}>
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
      <ThemedText type="small" themeColor="textSecondary">
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.three },
  content: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.four },
  card: { padding: Spacing.three, borderRadius: 16 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Brand.primary, fontSize: 18, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.two },
  divider: { height: 1, backgroundColor: '#E7EBF0' },
  connect: { height: 50, borderRadius: 14, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  connectText: { color: Brand.onPrimary, fontSize: 15, fontWeight: '700' },
  signout: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: '#E3B7B7', alignItems: 'center', justifyContent: 'center' },
  signoutText: { color: '#D14343', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
