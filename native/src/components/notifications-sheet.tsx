// Ειδοποιήσεις — native attention inbox (parity with web AttentionInboxBar).
// Lists customer responses from GET /api/notifications; inline accept/reject for
// appointment time-change requests (PATCH /api/tasks/[id] + POST
// /api/appointment-notifications). Tap a row → open the customer.

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatWhen } from '@/lib/format';

export interface NotificationItem {
  id: string;
  kind: string;
  response: string;
  title: string;
  description: string;
  customerId: string | null;
  customerName: string;
  eventAt: string;
  taskId: string | null;
  requestedDueDate: string | null;
  requestedDueTime: string | null;
}

const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  offer: 'document-text',
  appointment: 'calendar',
  intake: 'clipboard',
  upload: 'images',
  call: 'call',
  sms: 'chatbubble',
};

export function NotificationsSheet({
  visible,
  onClose,
  onOpenCustomer,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, 'accepted' | 'rejected'>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ ok?: boolean; notifications?: NotificationItem[] }>('/api/notifications');
      setItems(res?.notifications ?? []);
      setError(false);
    } catch {
      // Distinguish a network error from a genuinely empty inbox.
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  async function acceptTimeChange(n: NotificationItem) {
    if (!n.taskId || !n.requestedDueDate || !n.requestedDueTime) return;
    setBusyId(n.id);
    try {
      const r = await apiPatch<{ ok?: boolean }>(`/api/tasks/${n.taskId}`, { dueDate: n.requestedDueDate, dueTime: n.requestedDueTime });
      if (!r?.ok) return;
      await apiPost('/api/appointment-notifications', { taskId: n.taskId, kind: 'time_change_approved', mode: 'send' }).catch(() => {});
      setResolved((p) => ({ ...p, [n.id]: 'accepted' }));
    } finally {
      setBusyId(null);
    }
  }

  async function rejectTimeChange(n: NotificationItem) {
    if (!n.taskId) return;
    setBusyId(n.id);
    try {
      await apiPost('/api/appointment-notifications', { taskId: n.taskId, kind: 'time_change_rejected', mode: 'send' }).catch(() => {});
      setResolved((p) => ({ ...p, [n.id]: 'rejected' }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SheetModal visible={visible} title="Ειδοποιήσεις" onClose={onClose}>
      {loading ? (
        <ActivityIndicator color={Brand.primary} style={{ marginVertical: Spacing.four }} />
      ) : error && items.length === 0 ? (
        <View style={styles.errorWrap}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Δεν φορτώθηκαν τα στοιχεία.
          </ThemedText>
          <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={() => void load()} />
        </View>
      ) : items.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          Καμία νέα ειδοποίηση.
        </ThemedText>
      ) : (
        <ScrollView style={styles.list}>
          {items.map((n) => {
            const isTimeChange = n.kind === 'appointment' && n.response === 'time_change_requested' && !!n.taskId;
            const done = resolved[n.id];
            return (
              <View key={n.id} style={styles.item}>
                <Pressable
                  onPress={() => n.customerId && onOpenCustomer(n.customerId)}
                  style={({ pressed }) => [styles.itemMain, pressed && styles.pressed]}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={ICON[n.kind] ?? 'notifications'} size={18} color={Brand.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.dark}>{n.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {[n.customerName, n.description].filter(Boolean).join(' · ')}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.time}>{formatWhen(n.eventAt)}</ThemedText>
                  </View>
                </Pressable>
                {isTimeChange && !done ? (
                  <View style={styles.actions}>
                    <Pressable disabled={busyId === n.id} onPress={() => void acceptTimeChange(n)} style={({ pressed }) => [styles.accept, pressed && styles.pressed]}>
                      <ThemedText type="small" style={styles.acceptText}>Αποδοχή νέας ώρας</ThemedText>
                    </Pressable>
                    <Pressable disabled={busyId === n.id} onPress={() => void rejectTimeChange(n)} style={({ pressed }) => [styles.reject, pressed && styles.pressed]}>
                      <ThemedText type="small" style={styles.rejectText}>Απόρριψη</ThemedText>
                    </Pressable>
                  </View>
                ) : done ? (
                  <ThemedText type="small" style={done === 'accepted' ? styles.okText : styles.noText}>
                    {done === 'accepted' ? 'Έγινε αποδοχή ✓' : 'Απορρίφθηκε'}
                  </ThemedText>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </SheetModal>
  );
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    empty: { paddingVertical: Spacing.four, textAlign: 'center' },
    errorWrap: { paddingVertical: Spacing.two, gap: Spacing.two },
    list: { maxHeight: 460 },
    dark: { color: c.text },
    item: { borderBottomWidth: 1, borderBottomColor: c.border, paddingVertical: Spacing.two },
    itemMain: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
    iconWrap: { width: 34, height: 34, borderRadius: 17, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
    time: { fontSize: 11, marginTop: 2 },
    actions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two, paddingLeft: 46 },
    accept: { backgroundColor: Brand.primary, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 7 },
    acceptText: { color: '#FFFFFF', fontWeight: '700' },
    reject: { backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: 7 },
    rejectText: { color: c.textSecondary, fontWeight: '700' },
    okText: { color: '#1B8A4C', fontWeight: '700', marginTop: Spacing.one, paddingLeft: 46 },
    noText: { color: '#D14343', fontWeight: '700', marginTop: Spacing.one, paddingLeft: 46 },
    pressed: { opacity: 0.6 },
  });
