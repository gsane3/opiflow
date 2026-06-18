// «Τι χρειάζεται τώρα» — CAM Attention card (native parity, v1).
//
// Native mirror of the web AttentionCard: computed folder STATE ("who are we
// waiting on"), complementing the Next Best Action card below (which carries the
// ACTION). Only the urgent reply shortcut is a button here. Renders nothing when
// attention is null (closed/not-found) and fails gracefully on fetch errors.

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet } from '@/lib/api';

type WaitingOn = 'business' | 'customer' | 'date' | 'none';
type Severity = 'info' | 'warning' | 'urgent';

interface ClientFolderAttention {
  waitingOn: WaitingOn;
  severity: Severity;
  label: string;
  explanation: string | null;
  dueAt: string | null;
  source: string;
  cta: { actionType: string; label: string } | null;
}

const C_DANGER = '#D14343';
const C_WARN = '#E0922F';
const SEVERITY_COLOR: Record<Severity, string> = { urgent: C_DANGER, warning: C_WARN, info: Brand.primary };
const WAITING_CHIP: Record<WaitingOn, string> = {
  business: 'Χρειάζεται ενέργεια',
  customer: 'Περιμένει ο πελάτης',
  date: 'Υπενθύμιση',
  none: 'Όλα εντάξει',
};

export default function AttentionCard({
  endpoint, refreshKey = 0, onExecute,
}: {
  endpoint: string;
  refreshKey?: number;
  onExecute: (actionType: string) => void;
}) {
  const c = useTheme();
  const styles = makeStyles(c);
  const [attention, setAttention] = useState<ClientFolderAttention | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ ok?: boolean; attention?: ClientFolderAttention | null }>(endpoint);
      setAttention(r?.ok && r.attention ? r.attention : null);
    } catch { setAttention(null); }
  }, [endpoint]);

  // Driven by the NBA card's onLoaded (see ProjectProcessScreen) so attention is
  // read only after the NBA row is (re)persisted — never contradicting it. Skip
  // the refreshKey===0 mount so the first read waits for that signal.
  useEffect(() => { if (refreshKey > 0) void load(); }, [load, refreshKey]);

  if (!attention) return null;
  const color = SEVERITY_COLOR[attention.severity];

  return (
    <View style={[styles.card, { backgroundColor: `${color}12`, borderColor: `${color}44` }]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <ThemedText style={styles.headText}>ΤΙ ΧΡΕΙΑΖΕΤΑΙ ΤΩΡΑ</ThemedText>
        <View style={[styles.chip, { backgroundColor: `${color}22` }]}>
          <ThemedText style={[styles.chipText, { color }]}>{WAITING_CHIP[attention.waitingOn]}</ThemedText>
        </View>
      </View>
      <ThemedText type="smallBold" style={styles.label}>{attention.label}</ThemedText>
      {attention.explanation ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.expl}>{attention.explanation}</ThemedText>
      ) : null}
      {attention.cta ? (
        <Pressable onPress={() => onExecute(attention.cta!.actionType)} style={({ pressed }) => [styles.cta, { backgroundColor: color }, pressed && styles.dim]}>
          <Ionicons name="chatbubble-outline" size={15} color={Brand.onPrimary} />
          <ThemedText type="smallBold" style={styles.ctaText}>{attention.cta.label}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  headText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, color: c.textSecondary },
  chip: { marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  chipText: { fontSize: 11, fontWeight: '700' },
  label: { color: c.text, fontSize: 15.5 },
  expl: { lineHeight: 18 },
  cta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginTop: 4 },
  ctaText: { color: Brand.onPrimary },
  dim: { opacity: 0.6 },
});
