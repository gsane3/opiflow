// Κλήσεις — in-app dialer (Twilio) + recent-calls history with AI-brief excerpts.
// Accepts ?num=<phone> (from the customer workspace) to prefill the keypad.

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { LinearGradient } from 'expo-linear-gradient';

import { CallActionSheet } from '@/components/call-action-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, BrandGradient, Shadow, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet } from '@/lib/api';
import { maybePromptIntakeFor } from '@/lib/intake-prompt';
import { hapticTap } from '@/lib/haptics';
import { briefExcerpt, formatWhen } from '@/lib/format';
import { type ActiveCall, type CallStatus } from '@/lib/twilio-state';
import type { Communication } from '@/lib/types';

const KEYS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

const SUBS: Record<string, string> = {
  '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO',
  '7': 'PQRS', '8': 'TUV', '9': 'WXYZ', '0': '+',
};

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Σύνδεση…',
  ringing: 'Κουδουνίζει…',
  connected: 'Σε κλήση',
  disconnected: 'Τερματίστηκε',
  failed: 'Απέτυχε',
};

export default function CallsScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const { num: prefill } = useLocalSearchParams<{ num?: string }>();

  const [tab, setTab] = useState<'keypad' | 'recent'>('keypad');
  const [num, setNum] = useState('');
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [status, setStatus] = useState<CallStatus | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [showDtmf, setShowDtmf] = useState(false);
  const [dtmfSent, setDtmfSent] = useState('');
  const [debug, setDebug] = useState('');
  const [callSeconds, setCallSeconds] = useState(0);

  const [recent, setRecent] = useState<Communication[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetCall, setSheetCall] = useState<Communication | null>(null);
  // When the sheet is the just-ended call, it polls for the AI brief.
  const [sheetPolling, setSheetPolling] = useState(false);

  // Prefill from the customer workspace («Κλήση» button).
  useEffect(() => {
    if (typeof prefill === 'string' && prefill.trim()) {
      setNum(prefill.replace(/[^\d+*#]/g, '').slice(0, 24));
      setTab('keypad');
    }
  }, [prefill]);

  // Live mm:ss timer once connected (parity with the incoming modal + web B5).
  useEffect(() => {
    if (status !== 'connected') { setCallSeconds(0); return; }
    setCallSeconds(0);
    const id = setInterval(() => setCallSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

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

  // End-of-call intake prompt lives in the shared helper (also used by the
  // inbound incoming-call modal) so the behaviour is identical everywhere.

  const dial = useCallback(
    async (target?: string) => {
      const number = (target ?? num).trim();
      if (!number) return;
      if (target) setNum(target);
      void hapticTap();
      setDebug('');
      setStatus('connecting');
      try {
        // Load the voice SDK on-demand (never at startup — see _layout.tsx).
        const { placeCall } = await import('@/lib/twilio');
        const handle = await placeCall(
          number,
          (s) => {
            setStatus(s);
            if (s === 'disconnected' || s === 'failed') {
              setCall(null);
              setMuted(false);
              setSpeaker(false);
              setShowDtmf(false);
              setDtmfSent('');
              setTimeout(() => setStatus(null), 1200);
              // Background refresh of «Πρόσφατες»; the post-call card (opened
              // from onLogged below) polls for the brief directly.
              setTimeout(() => void loadRecent(), 1500);
            }
          },
          undefined,
          (r) => {
            // Auto-present the post-call card for the just-ended call. Completed
            // calls have a recording → poll for the transcript brief; a failed/
            // no-answer call has none → show actions immediately (no polling).
            if (!r.communicationId) {
              void loadRecent();
              return;
            }
            setSheetPolling(r.status === 'completed');
            setSheetCall({
              id: r.communicationId,
              customerId: null,
              channel: 'call',
              direction: 'outbound',
              status: r.status,
              phone: number,
              summary: null,
              createdAt: new Date().toISOString(),
              customer: null,
            });
            // End-of-call popup: ask to send the details request (only for
            // completed calls to a not-yet-named number).
            if (r.status === 'completed') void maybePromptIntakeFor(number, loadRecent);
          },
        );
        setCall(handle);
      } catch (e) {
        setStatus(null);
        const msg = e instanceof Error ? e.message : 'Άγνωστο σφάλμα.';
        setDebug('ERROR: ' + msg);
        Alert.alert('Αποτυχία κλήσης', msg);
      }
    },
    [num, loadRecent],
  );

  function hangup() {
    call?.disconnect();
    setCall(null);
    setStatus(null);
    setMuted(false);
    setSpeaker(false);
    setShowDtmf(false);
    setDtmfSent('');
    setTimeout(() => void loadRecent(), 1500);
  }

  function toggleMute() {
    if (!call) return;
    const next = !muted;
    call.mute(next);
    setMuted(next);
  }

  function toggleSpeaker() {
    if (!call) return;
    const next = !speaker;
    call.setSpeaker(next);
    setSpeaker(next);
  }

  function sendDtmf(k: string) {
    if (!call) return;
    call.sendDigits(k);
    setDtmfSent((d) => (d + k).slice(-16));
  }

  const inCall = call !== null || status === 'connecting';
  const callTimer = `${Math.floor(callSeconds / 60)}:${String(callSeconds % 60).padStart(2, '0')}`;
  const ringing = status === 'connecting' || status === 'ringing';

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
              // Always refresh — the list goes stale after the user's own calls.
              void loadRecent();
            }}
          />
        </View>

        {tab === 'keypad' ? (
          <View style={styles.keypadWrap}>
            <View style={styles.display}>
              {num ? (
                <ThemedText style={styles.number} numberOfLines={1} ellipsizeMode="head">
                  {num}
                </ThemedText>
              ) : (
                <ThemedText style={styles.numberPlaceholder}>Εισήγαγε αριθμό</ThemedText>
              )}
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
                      {SUBS[k] ? <ThemedText style={styles.keySub}>{SUBS[k]}</ThemedText> : null}
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>

            <View style={styles.actionRow}>
              <View style={styles.sideSlot} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Κλήση"
                onPress={() => void dial()}
                disabled={!num}
                style={({ pressed }) => [styles.callBtn, !num && styles.disabled, pressed && styles.pressed]}>
                <Ionicons name="call" size={26} color="#FFFFFF" />
              </Pressable>
              <View style={styles.sideSlot}>
                {num ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Διαγραφή ψηφίου"
                    onPress={back}
                    style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
                    <Ionicons name="backspace-outline" size={26} color={c.textSecondary} />
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
                    setSheetPolling(false);
                    setSheetCall(item);
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
                      accessibilityRole="button"
                      accessibilityLabel="Κλήση"
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

      <CallActionSheet
        call={sheetCall}
        polling={sheetPolling}
        onClose={() => {
          setSheetCall(null);
          setSheetPolling(false);
        }}
        onChanged={() => void loadRecent()}
        onOpenCustomer={(cid) => router.push({ pathname: '/customers/[id]', params: { id: cid } })}
        onDial={(phone) => {
          setNum(phone.replace(/[^\d+*#]/g, '').slice(0, 24));
          setTab('keypad');
        }}
      />

      {/* In-call overlay — branded full-screen (parity with the incoming modal + web B5) */}
      {inCall ? (
        <LinearGradient colors={[...BrandGradient]} style={styles.overlay}>
          <SafeAreaView style={styles.overlaySafe}>
            <View style={styles.overlayTop}>
              <View style={styles.overlayAvatar}>
                <Ionicons name="call" size={48} color="#FFFFFF" />
              </View>
              <ThemedText style={styles.overlayNumber} numberOfLines={1}>{num || 'Κλήση'}</ThemedText>
              <View style={styles.overlayStatusRow}>
                {ringing ? <ActivityIndicator color="#FFFFFF" /> : null}
                <ThemedText style={styles.overlayStatus}>
                  {status === 'connected' ? callTimer : status ? STATUS_LABEL[status] : ''}
                </ThemedText>
              </View>
            </View>
            <View style={styles.overlayBottom}>
              {/* DTMF pad for IVRs («πατήστε 1 για…») */}
              {showDtmf ? (
                <View style={styles.dtmfPad}>
                  {dtmfSent ? <ThemedText style={styles.dtmfSent}>{dtmfSent}</ThemedText> : null}
                  {KEYS.map((row, i) => (
                    <View key={i} style={styles.dtmfRow}>
                      {row.map((k) => (
                        <Pressable
                          key={k}
                          accessibilityRole="button"
                          accessibilityLabel={`Πλήκτρο ${k}`}
                          onPress={() => sendDtmf(k)}
                          style={({ pressed }) => [styles.dtmfKey, pressed && styles.pressed]}>
                          <ThemedText style={styles.dtmfKeyText}>{k}</ThemedText>
                        </Pressable>
                      ))}
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.overlayControls}>
                <View style={styles.ctrlCol}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Σίγαση" onPress={toggleMute} style={({ pressed }) => [styles.ctrlRound, muted && styles.ctrlInvert, pressed && styles.pressed]}>
                    <Ionicons name={muted ? 'mic-off' : 'mic'} size={26} color={muted ? Brand.navy : '#FFFFFF'} />
                  </Pressable>
                  <ThemedText style={styles.ctrlLabel}>{muted ? 'Άρση' : 'Σίγαση'}</ThemedText>
                </View>
                <View style={styles.ctrlCol}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Ηχείο" onPress={toggleSpeaker} style={({ pressed }) => [styles.ctrlRound, speaker && styles.ctrlActive, pressed && styles.pressed]}>
                    <Ionicons name="volume-high" size={26} color="#FFFFFF" />
                  </Pressable>
                  <ThemedText style={styles.ctrlLabel}>Ηχείο</ThemedText>
                </View>
                <View style={styles.ctrlCol}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Πληκτρολόγιο" onPress={() => setShowDtmf((v) => !v)} style={({ pressed }) => [styles.ctrlRound, showDtmf && styles.ctrlActive, pressed && styles.pressed]}>
                    <Ionicons name="keypad" size={26} color="#FFFFFF" />
                  </Pressable>
                  <ThemedText style={styles.ctrlLabel}>Πλήκτρα</ThemedText>
                </View>
                <View style={styles.ctrlCol}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Τερματισμός" onPress={hangup} style={({ pressed }) => [styles.ctrlRound, styles.hangup, pressed && styles.pressed]}>
                    <Ionicons name="call" size={26} color="#FFFFFF" style={styles.hangupIcon} />
                  </Pressable>
                  <ThemedText style={styles.ctrlLabel}>Τέλος</ThemedText>
                </View>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>
      ) : null}
    </ThemedView>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Pressable onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <ThemedText type="smallBold" style={active ? styles.tabTextActive : styles.tabText}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const KEY = 76;

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingBottom: BottomTabInset + Spacing.two },
  title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    backgroundColor: c.surface,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tabBtn: { flex: 1, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabBtnActive: { backgroundColor: c.card, shadowColor: '#11273B', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText: { color: c.textSecondary },
  tabTextActive: { color: Brand.primary },

  keypadWrap: { flex: 1, alignItems: 'center' },
  display: { minHeight: 84, justifyContent: 'center', alignItems: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
  number: { fontSize: 34, lineHeight: 44, fontWeight: '700', letterSpacing: 1, color: c.text },
  numberPlaceholder: { fontSize: 17, fontWeight: '500', color: c.textFaint },
  debug: { textAlign: 'center', paddingHorizontal: Spacing.four },
  pad: { gap: Spacing.three, marginTop: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.four, justifyContent: 'center' },
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.borderFaint, ...Shadow.card },
  keyPressed: { backgroundColor: c.surface },
  keyText: { fontSize: 29, fontWeight: '600', color: c.text, lineHeight: 32 },
  keySub: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.5, color: c.textSecondary, marginTop: -1 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four, marginTop: Spacing.three },
  sideSlot: { width: KEY, alignItems: 'center' },
  callBtn: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: '#21A05A', alignItems: 'center', justifyContent: 'center', shadowColor: '#21A05A', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  back: { width: KEY, height: KEY, borderRadius: KEY / 2, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },

  recentList: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, paddingBottom: Spacing.four },
  sep: { height: 1, backgroundColor: c.border, marginLeft: 40 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  recentBody: { flex: 1, gap: 2 },
  missedText: { color: '#D14343' },
  recentCallBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },

  overlay: { ...StyleSheet.absoluteFillObject },
  overlaySafe: { flex: 1, justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.six },
  overlayTop: { alignItems: 'center', gap: Spacing.three, marginTop: Spacing.six },
  overlayAvatar: { width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  overlayNumber: { color: '#FFFFFF', fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: 0.5 },
  overlayStatusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  overlayStatus: { color: 'rgba(255,255,255,0.75)', fontSize: 16 },
  overlayBottom: { alignItems: 'center', gap: Spacing.four, marginBottom: Spacing.five },
  overlayControls: { flexDirection: 'row', gap: Spacing.three },
  ctrlCol: { alignItems: 'center', gap: Spacing.two, width: 72 },
  ctrlRound: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  ctrlActive: { backgroundColor: 'rgba(255,255,255,0.45)' },
  ctrlInvert: { backgroundColor: '#FFFFFF' },
  ctrlLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
  hangup: { backgroundColor: '#E5484D' },
  hangupIcon: { transform: [{ rotate: '135deg' }] },

  dtmfPad: { gap: Spacing.two, alignItems: 'center' },
  dtmfSent: { color: 'rgba(255,255,255,0.85)', fontSize: 18, letterSpacing: 2, fontWeight: '700' },
  dtmfRow: { flexDirection: 'row', gap: Spacing.three },
  dtmfKey: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  dtmfKeyText: { color: '#FFFFFF', fontSize: 24, lineHeight: 30, fontWeight: '600' },
});

