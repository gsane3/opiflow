import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? '';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.logo}>
            <ThemedText style={styles.logoMark}>O</ThemedText>
          </View>
          <View style={styles.headerText}>
            <ThemedText type="subtitle">Αρχική</ThemedText>
            {email ? (
              <ThemedText type="small" themeColor="textSecondary">
                {email}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Συνδεδεμένος ✓</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Σύντομα εδώ: τα ραντεβού &amp; οι κλήσεις της ημέρας. Δες τους πελάτες σου στην
            καρτέλα «Πελάτες».
          </ThemedText>
        </ThemedView>

        <View style={styles.spacer} />

        <Pressable
          onPress={signOut}
          style={({ pressed }) => [styles.signout, pressed && styles.pressed]}>
          <ThemedText style={styles.signoutText}>Αποσύνδεση</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.three },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingTop: Spacing.four },
  headerText: { gap: 2 },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  logoMark: { color: Brand.onPrimary, fontSize: 30, fontWeight: '800' },
  card: { marginTop: Spacing.five, padding: Spacing.three, borderRadius: 16, gap: Spacing.two },
  spacer: { flex: 1 },
  signout: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#D8DEE6', alignItems: 'center', justifyContent: 'center' },
  signoutText: { color: '#D14343', fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
