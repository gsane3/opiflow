// «Προτεινόμενη ενέργεια» — the single Next Best Action card (native, CAM v1).
//
// Native parity of the web NextActionCard: ONE recommended action per work folder
// (or per customer with no folder). Self-contained — fetches the recommendation,
// renders one card, and owns «Όχι τώρα» (dismiss) / «Υπενθύμισέ μου αργότερα»
// (snooze) via PATCH. «Εκτέλεση» delegates to the host (onExecute) which opens the
// matching existing flow; nothing is auto-sent to the customer. Renders nothing for
// no_action / null (and degrades gracefully before migration 054 is applied).

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPatch } from '@/lib/api';

export type NextActionType =
  | 'create_work_folder' | 'share_folder_link' | 'request_photos' | 'request_customer_details'
  | 'create_offer' | 'schedule_appointment' | 'send_follow_up' | 'reply_to_customer'
  | 'mark_work_done' | 'no_action';

interface ClientNextAction {
  id: string | null;
  actionType: NextActionType;
  title: string;
  explanation: string;
  confidence: number | null;
  dueAt: string | null;
  persistent: boolean;
}

const ACTION_ICON: Record<NextActionType, keyof typeof Ionicons.glyphMap> = {
  create_work_folder: 'folder-open-outline',
  share_folder_link: 'share-outline',
  request_photos: 'image-outline',
  request_customer_details: 'clipboard-outline',
  create_offer: 'document-text-outline',
  schedule_appointment: 'calendar-outline',
  send_follow_up: 'send-outline',
  reply_to_customer: 'chatbubble-outline',
  mark_work_done: 'checkmark-circle-outline',
  no_action: 'sparkles',
};

export default function NextActionCard({
  endpoint, refreshKey = 0, onExecute, onLoaded,
}: {
  endpoint: string;
  refreshKey?: number;
  onExecute: (actionType: NextActionType) => void;
  /** Fired after each GET resolves — lets the AttentionCard read the freshly
   *  persisted next_actions row, avoiding a contradictory attention state. */
  onLoaded?: () => void;
}) {
  const c = useTheme();
  const styles = makeStyles(c);
  const [action, setAction] = useState<ClientNextAction | null>(null);
  const [hidden, setHidden] = useState(false);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ ok?: boolean; action?: ClientNextAction | null }>(endpoint);
      if (r?.ok && r.action && r.action.actionType !== 'no_action') { setAction(r.action); setHidden(false); }
      else setAction(null);
    } catch { setAction(null); }
    finally { onLoadedRef.current?.(); }
  }, [endpoint]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function patch(lifecycle: 'accept' | 'dismiss' | 'snooze') {
    if (!action?.id) return; // computed-only (pre-migration) → local-only
    try { await apiPatch(endpoint, { id: action.id, action: lifecycle }); } catch { /* best-effort */ }
  }

  function execute() {
    if (!action) return;
    const t = action.actionType;
    void patch('accept');
    setHidden(true);
    onExecute(t);
  }

  if (!action || hidden) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="sparkles" size={15} color={Brand.primary} />
        <ThemedText style={styles.headText}>ΠΡΟΤΕΙΝΟΜΕΝΗ ΕΝΕΡΓΕΙΑ</ThemedText>
      </View>
      <View style={styles.main}>
        <View style={styles.icon}>
          <Ionicons name={ACTION_ICON[action.actionType] ?? 'sparkles'} size={22} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText type="smallBold" style={styles.title}>{action.title}</ThemedText>
          {action.explanation ? <ThemedText type="small" themeColor="textSecondary" style={styles.expl}>{action.explanation}</ThemedText> : null}
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={execute} style={({ pressed }) => [styles.primary, pressed && styles.dim]}>
          <Ionicons name="arrow-forward" size={16} color={Brand.onPrimary} />
          <ThemedText type="smallBold" style={styles.primaryText}>Εκτέλεση</ThemedText>
        </Pressable>
        <Pressable onPress={() => { void patch('dismiss'); setHidden(true); }} style={({ pressed }) => [styles.ghost, pressed && styles.dim]}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.ghostText}>Όχι τώρα</ThemedText>
        </Pressable>
        <Pressable onPress={() => { void patch('snooze'); setHidden(true); }} style={({ pressed }) => [styles.later, pressed && styles.dim]}>
          <Ionicons name="time-outline" size={15} color={Brand.primary} />
          <ThemedText type="small" style={styles.laterText}>Αργότερα</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  card: { backgroundColor: Brand.primarySoft, borderWidth: 1, borderColor: `${Brand.primary}44`, borderRadius: 18, padding: Spacing.three, gap: Spacing.two },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, color: Brand.primary },
  main: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: Brand.primary, alignItems: 'center', justifyContent: 'center' },
  title: { color: c.text, fontSize: 15.5 },
  expl: { lineHeight: 18, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 15, paddingVertical: 9, borderRadius: 999, backgroundColor: Brand.primary },
  primaryText: { color: Brand.onPrimary },
  ghost: { paddingHorizontal: 10, paddingVertical: 9 },
  ghostText: { fontWeight: '700' },
  later: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 9 },
  laterText: { color: Brand.primary, fontWeight: '700' },
  dim: { opacity: 0.6 },
});
