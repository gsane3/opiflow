// Κλήσεις — in-app dialer (Twilio) + recent-calls history with AI-brief excerpts.
// Accepts ?num=<phone> (from the customer workspace) to prefill the keypad.

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing } from '@/constants/theme';
import { apiGet } from '@/lib/api';
import { briefExcerpt, formatWhen } from '@/lib/format';
import { type ActiveCall, type CallStatus } from '@/lib/twilio-state';
import type { Communication } from '@/lib/types';

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
  const router = useRouter();
  const { num: prefill } = useLocalSearchParams<{ num?: string }>();

  const [tab, setTab] = useState<'keypad' | 'recent'>('keypad');
  const [num, setNum] = useState('');
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);
  const [muted, setMuted] = useState(false);
  const [debug, setDebug] = useState('');

  const [recent, setRecent] = useState<Communication[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Prefill from the customer workspace («Κλήση» button).
  useEffect(() => {
    if (typeof prefill === 'string' && prefill.trim()) {
      setNum(prefill.replace(/[^\d+*#]/g, '').slice(0, 24));
      setTab('keypad');
    }
  }, [prefill]);

  const loadRecent = useCallback(async () => {
    setRecentLoading(true);
    try {
      const json = await apiGet<{ communications?: Communication[] }>(
        '/api/communications?channel=call&limit=30',
      );
      setRecent(json?.communications ?? []);
    } catch {
      // pull-to-refresh retries
    } finally {
      setRecentLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'recent' && recent.length === 0) void loadRecent();
  }, [tab, recent.length, loadRecent]);

  const press = (k: string) => setNum((n) => (n + k).slice(0, 24));
  const back = () => setNum((n) => n.slice(0, -1));

  const dial = useCallback(
    async (target?: string) => {
      const number = (target ?? num).trim();
      if (!number) return;
      if (target) setNum(target);
      setDebug('');
      setStatus('connecting');
      try {
        // Load the voice SDK on-demand (never at startup — see _layout.tsx).
        const { placeCall } = await import('@/lib/twilio');
        const handle = await placeCall(number, (s) => {
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
        const msg = e instanceof Error ? e.message : 'Άγνωστο σφάλμα.';
        setDebug('ERROR: ' + msg);
        Alert.alert('Αποτυχία κλήσης', msg);
      }
    },
    [num],
  );

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

        {/* Tabs */}
        <View style={styles.tabs}>
          <TabButton label="Πληκτρολόγιο" active={tab === 'keypad'} onPress={() => setTab('keypad')} />
          <TabButton
            label="Πρόσφατες"
            active={tab === 'recent'}
            onPress={() => {
              setTab('recent');
              if (recent.length === 0) void loadRecent();
            }}
          />
        </View>

        {tab === 'keypad' ? (
          <View style={styles.keypadWrap}>
            <View style={styles.display}>
              <ThemedText style={styles.number} numberOfLines={1}>
                {num || ' '}
              </ThemedText>
            </View>

            {debug ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.debug}>
                {debug}
              </ThemedText>
            ) : null}

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
                onPress={() => void dial()}
                disabled={!num}
                style={({ pressed }) => [styles.callBtn, !num && styles.disabled, pressed && styles.pressed]}>
                <Ionicons name="call" size={26} color="#FFFFFF" />
              </Pressable>
              <View style={styles.sideSlot}>
                {num ? (
                  <Pressable onPress={back} style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
                    <Ionicons name="backspace-outline" size={26} color="#5B6472" />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        ) : recentLoading && recent.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={Brand.primary} />
          </View>
        ) : recent.length === 0 ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">Καμία κλήση ακόμα.</ThemedText>
          </View>
        ) : (
          <FlatList
            data={recent}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.recentList}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void loadRecent();
                }}
                tintColor={Brand.primary}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => {
              const missed = item.direction === 'inbound' && item.status !== 'completed';
              const name = item.customer?.name ?? item.phone ?? 'Άγνωστος';
              return (
                <Pressable
                  onPress={() => {
                    if (item.customerId) {
                      router.push({ pathname: '/customers/[id]', params: { id: item.customerId } });
                    } else if (item.phone) {
                      setNum(item.phone.replace(/[^\d+*#]/g, '').slice(0, 24));
                      setTab('keypad');
                    }
                  }}
                  style={({ pressed }) => [styles.recentRow, pressed && styles.pressed]}>
                  <Ionicons
                    name={item.direction === 'inbound' ? 'arrow-down-circle' : 'arrow-up-circle'}
                    size={26}
                    color={missed ? '#D14343' : Brand.primary}
                  />
                  <View style={styles.recentBody}>
                    <ThemedText type="smallBold" style={missed ? styles.missedText : undefined}>
                      {name}
                      {missed ? ' · αναπάντητη' : ''}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {briefExcerpt(item.summary) || formatWhen(item.createdAt)}
                    </ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatWhen(item.createdAt)}
                  </ThemedText>
                  {item.phone ? (
                    <Pressable
                      onPress={() => void dial(item.phone ?? '')}
                      hitSlop={8}
                      style={({ pressed }) => [styles.recentCallBtn, pressed && styles.pressed]}>
                      <Ionicons name="call" size={18} color={Brand.primary} />
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
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
                <ThemedText style={styles.overlayStatus}>{status ? STATUS_LABEL[status] : ''}</ThemedText>
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

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <ThemedText type="smallBold" style={active ? styles.tabTextActive : styles.tabText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const KEY = 76;

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingBottom: BottomTabInset + Spacing.two },
  title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    backgroundColor: '#F2F4F7',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tabBtn: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabBtnActive: { backgroundColor: '#FFFFFF', shadowColor: '#0A1120', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText: { color: '#5B6472' },
  tabTextActive: { color: Brand.primary },

  keypadWrap: { flex: 1, alignItems: 'center' },
  display: { minHeight: 60, justifyContent: 'center', alignItems: 'center', paddingVertical: Spacing.two },
  number: { fontSize: 34, fontWeight: '600', letterSpacing: 1 },
  debug: { textAlign: 'center', paddingHorizontal: Spacing.four },
  pad: { gap: Spacing.three, marginTop: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.four, justifyContent: 'center' },
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: '#F2F4F7', alignItems: 'center', justifyContent: 'center' },
  keyPressed: { backgroundColor: '#E2E7EE' },
  keyText: { fontSize: 30, fontWeight: '500' },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four, marginTop: Spacing.three },
  sideSlot: { width: KEY, alignItems: 'center' },
  callBtn: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: '#21A05A', alignItems: 'center', justifyContent: 'center' },
  back: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },

  recentList: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.four },
  sep: { height: 1, backgroundColor: '#EEF1F5', marginLeft: 40 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  recentBody: { flex: 1, gap: 2 },
  missedText: { color: '#D14343' },
  recentCallBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },

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
