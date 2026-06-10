import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { placeCall, type ActiveCall, type CallStatus } from '@/lib/twilio';

const KEYS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Σύνδεση…',
  ringing: 'Κουδουνίζει…',
  connected: 'Σε κλήση',
  disconnected: 'Τερματίστηκε',
  failed: 'Απέτυχε',
};

export default function CallsScreen() {
  const [num, setNum] = useState('');
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);
  const [muted, setMuted] = useState(false);

  const press = (k: string) => setNum((n) => (n + k).slice(0, 24));
  const back = () => setNum((n) => n.slice(0, -1));

  async function dial() {
    if (!num) return;
    setStatus('connecting');
    try {
      const handle = await placeCall(num, (s) => {
        setStatus(s);
        if (s === 'disconnected' || s === 'failed') {
          setCall(null);
          setMuted(false);
          setTimeout(() => setStatus(null), 1200);
        }
      });
      setCall(handle);
    } catch (e) {
      setStatus(null);
      Alert.alert('Αποτυχία κλήσης', e instanceof Error ? e.message : 'Άγνωστο σφάλμα.');
    }
  }

  function hangup() {
    call?.disconnect();
    setCall(null);
    setStatus(null);
    setMuted(false);
  }

  function toggleMute() {
    if (!call) return;
    const next = !muted;
    call.mute(next);
    setMuted(next);
  }

  const inCall = call !== null || status === 'connecting';

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
          <View style={styles.sideSlot} />
          <Pressable
            onPress={dial}
            disabled={!num}
            style={({ pressed }) => [styles.callBtn, !num && styles.disabled, pressed && styles.pressed]}>
            <ThemedText style={styles.callText}>Κλήση</ThemedText>
          </Pressable>
          <View style={styles.sideSlot}>
            {num ? (
              <Pressable onPress={back} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
                <ThemedText style={styles.backText}>⌫</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>

      {/* In-call overlay */}
      {inCall ? (
        <View style={styles.overlay}>
          <SafeAreaView style={styles.overlaySafe}>
            <View style={styles.overlayTop}>
              <ThemedText style={styles.overlayNumber}>{num}</ThemedText>
              <View style={styles.overlayStatusRow}>
                {status === 'connecting' || status === 'ringing' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : null}
                <ThemedText style={styles.overlayStatus}>
                  {status ? STATUS_LABEL[status] : ''}
                </ThemedText>
              </View>
            </View>
            <View style={styles.overlayControls}>
              <Pressable onPress={toggleMute} style={styles.ctrl}>
                <ThemedText style={styles.ctrlText}>{muted ? 'Άρση σίγασης' : 'Σίγαση'}</ThemedText>
              </Pressable>
              <Pressable onPress={hangup} style={[styles.ctrl, styles.hangup]}>
                <ThemedText style={styles.hangupText}>Τερματισμός</ThemedText>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      ) : null}
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
  sideSlot: { width: KEY, alignItems: 'center' },
  callBtn: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: '#21A05A', alignItems: 'center', justifyContent: 'center' },
  callText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  back: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: 26 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: Brand.primary },
  overlaySafe: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.six },
  overlayTop: { alignItems: 'center', gap: Spacing.three, marginTop: Spacing.six },
  overlayNumber: { color: '#FFFFFF', fontSize: 34, fontWeight: '700', letterSpacing: 1 },
  overlayStatusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  overlayStatus: { color: 'rgba(255,255,255,0.9)', fontSize: 17 },
  overlayControls: { flexDirection: 'row', gap: Spacing.four, marginBottom: Spacing.five },
  ctrl: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.three, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' },
  ctrlText: { color: '#FFFFFF', fontWeight: '700' },
  hangup: { backgroundColor: '#E5484D' },
  hangupText: { color: '#FFFFFF', fontWeight: '700' },
});
