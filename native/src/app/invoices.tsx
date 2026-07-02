// Τιμολόγια — συγκεντρωτική λίστα εκδοθέντων παραστατικών ανά μήνα, με
// «Αποστολή στον λογιστή» (share CSV κειμένου) ανά μήνα. Route: /invoices,
// φτάνει από το κουμπί «Τιμολόγια» της Αρχικής (ορατό μόνο με ενεργή τιμολόγηση).

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet } from '@/lib/api';
import { formatEuro } from '@/lib/format';

interface InvoiceRow {
  id: string;
  invoice_type: string | null;
  series: string | null;
  aa: string | number | null;
  issue_date: string | null;
  created_at?: string | null;
  counterparty_name: string | null;
  net_amount: number | null;
  vat_amount: number | null;
  total_amount: number | null;
  mark: string | null;
  qr_url: string | null;
}

const MONTHS_EL = [
  'Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος',
];

function monthKey(inv: InvoiceRow): string {
  return (inv.issue_date ?? inv.created_at ?? '').slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  const idx = Number(m) - 1;
  return idx >= 0 && idx < 12 ? `${MONTHS_EL[idx]} ${y}` : key;
}

function docLabel(inv: InvoiceRow): string {
  const kind = (inv.invoice_type ?? '').startsWith('11') ? 'Απόδειξη' : 'Τιμολόγιο';
  const num = [inv.series, inv.aa].filter((v) => v !== null && v !== undefined && `${v}` !== '').join('');
  return num ? `${kind} ${num}` : kind;
}

// Semicolon-separated (Greek Excel opens it into columns directly).
function buildAccountantCsv(label: string, rows: InvoiceRow[]): string {
  const header = 'Ημερομηνία;Παραστατικό;Πελάτης;Καθαρή αξία;ΦΠΑ;Σύνολο;ΜΑΡΚ';
  const lines = rows.map((r) =>
    [
      r.issue_date ?? '',
      docLabel(r),
      (r.counterparty_name ?? '').replace(/;/g, ','),
      r.net_amount ?? '',
      r.vat_amount ?? '',
      r.total_amount ?? '',
      r.mark ?? '',
    ].join(';'),
  );
  const total = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0);
  return `Τιμολόγια ${label} — Opiflow\n${header}\n${lines.join('\n')}\nΣύνολο;;;;;${total.toFixed(2)};`;
}

export default function InvoicesScreen() {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ invoices?: InvoiceRow[] }>('/api/invoicing/invoices?status=issued&limit=100');
      setInvoices(r?.invoices ?? []);
    } catch {
      // pull-to-refresh retries
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const months = useMemo(() => {
    const map = new Map<string, InvoiceRow[]>();
    for (const inv of invoices) {
      const k = monthKey(inv);
      if (!k) continue;
      const list = map.get(k) ?? [];
      list.push(inv);
      map.set(k, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [invoices]);

  async function shareMonth(key: string, rows: InvoiceRow[]) {
    try {
      await Share.share({ message: buildAccountantCsv(monthLabel(key), rows) });
    } catch {
      // user cancelled — nothing to do
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Πίσω" onPress={() => router.back()} hitSlop={8}>
            <Ionicons name="chevron-back" size={26} color={Brand.primary} />
          </Pressable>
          <ThemedText type="subtitle">Τιμολόγια</ThemedText>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={Brand.primary}
            />
          }>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={Brand.primary} />
            </View>
          ) : months.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              Δεν υπάρχουν εκδοθέντα παραστατικά ακόμη.
            </ThemedText>
          ) : (
            months.map(([key, rows]) => {
              const total = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0);
              return (
                <View key={key} style={styles.monthBlock}>
                  <View style={styles.monthHeader}>
                    <ThemedText type="smallBold">{monthLabel(key)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {rows.length} παρ. · {formatEuro(total)}
                    </ThemedText>
                  </View>
                  {rows.map((inv) => (
                    <Pressable
                      key={inv.id}
                      disabled={!inv.qr_url}
                      onPress={() => inv.qr_url && void WebBrowser.openBrowserAsync(inv.qr_url)}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                      <Ionicons name="receipt" size={20} color={Brand.primary} />
                      <View style={styles.rowBody}>
                        <ThemedText type="smallBold">{docLabel(inv)}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                          {[inv.issue_date, inv.counterparty_name].filter(Boolean).join(' · ')}
                          {inv.mark ? ` · ΜΑΡΚ ${inv.mark}` : ''}
                        </ThemedText>
                      </View>
                      <ThemedText type="smallBold">{formatEuro(inv.total_amount ?? 0)}</ThemedText>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void shareMonth(key, rows)}
                    style={({ pressed }) => [styles.shareBtn, pressed && styles.pressed]}>
                    <Ionicons name="share-outline" size={16} color={Brand.primary} />
                    <ThemedText type="small" style={styles.shareText}>
                      Αποστολή στον λογιστή
                    </ThemedText>
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    container: { flex: 1 },
    safe: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingTop: Spacing.two, paddingBottom: Spacing.two },
    content: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
    center: { paddingVertical: Spacing.six, alignItems: 'center' },
    empty: { paddingVertical: Spacing.four },
    monthBlock: { gap: Spacing.two },
    monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.two },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.three,
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: Spacing.three,
    },
    rowBody: { flex: 1, gap: 2 },
    shareBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: Brand.primary,
    },
    shareText: { color: Brand.primary, fontWeight: '700' },
    pressed: { opacity: 0.7 },
  });
