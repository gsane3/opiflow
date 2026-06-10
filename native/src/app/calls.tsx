import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';

const KEYS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

export default function CallsScreen() {
  const [num, setNum] = useState('');

  const press = (k: string) => setNum((n) => (n + k).slice(0, 24));
  const back = () => setNum((n) => n.slice(0, -1));
  // Interim: opens the device dialer. The native in-app call (Twilio) replaces this next.
  const call = () => {
    if (num) Linking.openURL(`tel:${num}`);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ThemedText type="subtitle" style={styles.title}>
          Κλήσεις
        </ThemedText>

        <View style={styles.display}>
          <ThemedText style={styles.number} numberOfLines={1}>
            {num || ' '}
          </ThemedText>
        </View>

        <View style={styles.pad}>
          {KEYS.map((row, i) => (
            <View key={i} style={styles.row}>
              {row.map((k) => (
                <Pressable
                  key={k}
                  onPress={() => press(k)}
                  style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}>
                  <ThemedText style={styles.keyText}>{k}</ThemedText>
                </Pressable>
              ))}
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <View style={styles.side} />
          <Pressable
            onPress={call}
            disabled={!num}
            style={({ pressed }) => [styles.callBtn, !num && styles.disabled, pressed && styles.pressed]}>
            <ThemedText style={styles.callText}>Κλήση</ThemedText>
          </Pressable>
          <View style={styles.side}>
            {num ? (
              <Pressable onPress={back} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
                <ThemedText style={styles.backText}>⌫</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const KEY = 76;

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingBottom: BottomTabInset + Spacing.three, alignItems: 'center' },
  title: { alignSelf: 'flex-start', paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  display: { minHeight: 64, justifyContent: 'center', alignItems: 'center', paddingVertical: Spacing.three },
  number: { fontSize: 34, fontWeight: '600', letterSpacing: 1 },
  pad: { gap: Spacing.three, marginTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.four, justifyContent: 'center' },
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  keyPressed: { backgroundColor: '#E2E7EE' },
  keyText: { fontSize: 30, fontWeight: '500' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four, marginTop: Spacing.four },
  side: { width: KEY, alignItems: 'center' },
  callBtn: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: '#21A05A', alignItems: 'center', justifyContent: 'center' },
  callText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  back: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
