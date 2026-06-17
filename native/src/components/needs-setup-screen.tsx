// Shown when a signed-in native user has NO business yet, or their subscription
// is not in an allowed state (404 / activationAllowed===false from
// /api/businesses/me). Mirrors the web AppShell gate, which routes such users to
// /package. Native can't run the plan/onboarding funnel in-app (IAP rules), so
// we send them to the website to finish setup, then let them retry.

import { Linking, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/ui';
import { Brand, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

const SETUP_URL = 'https://www.opiflow.ai/package';

export function NeedsSetupScreen({ onRetry }: { onRetry: () => void }) {
  const { signOut } = useAuth();
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.box}>
          <ThemedText type="title" style={styles.title}>
            Λίγο ακόμη
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.body}>
            Ολοκλήρωσε τη ρύθμιση του λογαριασμού σου — επίλεξε πλάνο και συμπλήρωσε
            τα στοιχεία της επιχείρησης στο opiflow.ai. Μόλις τελειώσεις, γύρνα εδώ
            και πάτα «Δοκίμασε ξανά».
          </ThemedText>
          <View style={styles.actions}>
            <PrimaryButton label="Συνέχεια στο opiflow.ai" onPress={() => void Linking.openURL(SETUP_URL)} />
            <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={onRetry} />
            <PrimaryButton label="Αποσύνδεση" tone="outline" onPress={() => void signOut()} />
          </View>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, justifyContent: 'center' },
  box: { paddingHorizontal: Spacing.five, gap: Spacing.three },
  title: { textAlign: 'center', color: Brand.primary },
  body: { textAlign: 'center', lineHeight: 22 },
  actions: { marginTop: Spacing.three, gap: Spacing.two },
});
