// Offer preview sheet — full offer document + status actions + resend.
// Mirrors the web OfferPreviewSheet (items table, totals, status, message send).

import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton, SheetModal } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatDate, formatEuro } from '@/lib/format';
import type { LinkDraft, Offer } from '@/lib/types';

const STATUS_GR: Record<string, string> = {
  draft: 'Πρόχειρη',
  ready_to_send: 'Έτοιμη για αποστολή',
  sent_manually: 'Στάλθηκε',
  sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή ✓',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
  cancelled: 'Ακυρώθηκε',
};

export function OfferPreviewSheet({
  offerId,
  onClose,
  onChanged,
}: {
  offerId: string | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<LinkDraft | null>(null);

  useEffect(() => {
    setOffer(null);
    setDraft(null);
    if (!offerId) return;
    void apiGet<{ ok?: boolean; offer?: Offer }>(`/api/offers/${offerId}`).then((res) => {
      if (res?.offer) setOffer(res.offer);
    });
  }, [offerId]);

  async function setStatus(status: string) {
    if (!offer) return;
    setBusy(true);
    try {
      const res = await apiPatch<{ ok?: boolean; offer?: Offer }>(`/api/offers/${offer.id}`, { status });
      if (res?.offer) setOffer(res.offer);
      onChanged?.();
    } catch {
      Alert.alert('Σφάλμα', 'Η αλλαγή κατάστασης απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  async function buildDraft() {
    if (!offer) return;
    setBusy(true);
    try {
      const d = await apiPost<LinkDraft>(`/api/offers/${offer.id}/notify`, { mode: 'draft' });
      if (d?.message) setDraft(d);
      else Alert.alert('Αποστολή', d?.error ?? 'Δεν υπάρχει διαθέσιμο μήνυμα (λείπει τηλέφωνο;).');
    } catch {
      Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε το μήνυμα.');
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!offer) return;
    setBusy(true);
    try {
      const r = await apiPost<LinkDraft>(`/api/offers/${offer.id}/notify`, { mode: 'send' });
      if (r?.sent === false && r.fallbackReason) Alert.alert('Αποστολή', `Εναλλακτικό κανάλι: ${r.fallbackReason}`);
      setDraft(null);
      onChanged?.();
      onClose();
    } catch {
      Alert.alert('Σφάλμα', 'Η αποστολή απέτυχε.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={!!offerId} title={offer ? `Προσφορά ${offer.offerNumber}` : 'Προσφορά'} onClose={onClose}>
      {!offer ? (
        <ThemedText type="small" themeColor="textSecondary">
          Φόρτωση…
        </ThemedText>
      ) : draft ? (
        <>
          <ThemedText type="smallBold">Μήνυμα προς {draft.recipient ?? 'πελάτη'}:</ThemedText>
          <View style={styles.msgBox}>
            <ThemedText type="small" style={styles.dark}>
              {draft.message}
            </ThemedText>
          </View>
          <PrimaryButton label="Αποστολή (Viber → SMS)" onPress={() => void send()} busy={busy} />
          <PrimaryButton label="Πίσω" tone="outline" onPress={() => setDraft(null)} />
        </>
      ) : (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDate(offer.createdAt)} · {STATUS_GR[offer.status] ?? offer.status}
          </ThemedText>

          <View style={styles.items}>
            {offer.items.map((it, i) => (
              <View key={i} style={styles.itemRow}>
                <View style={styles.itemDesc}>
                  <ThemedText type="small" style={styles.dark}>
                    {it.description}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {it.quantity} × {formatEuro(it.unitPrice)}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" style={styles.dark}>
                  {formatEuro(it.lineTotal ?? it.quantity * it.unitPrice)}
                </ThemedText>
              </View>
            ))}
          </View>

          <View style={styles.totals}>
            {typeof offer.subtotal === 'number' ? (
              <ThemedText type="small" themeColor="textSecondary">
                Υποσύνολο: {formatEuro(offer.subtotal)} · ΦΠΑ: {formatEuro(offer.vatAmount ?? 0)}
              </ThemedText>
            ) : null}
            <ThemedText type="smallBold" style={styles.total}>
              Σύνολο: {formatEuro(offer.total)}
            </ThemedText>
          </View>

          {offer.notes ? (
            <ThemedText type="small" themeColor="textSecondary">
              {offer.notes}
            </ThemedText>
          ) : null}

          <PrimaryButton label="Αποστολή / επαναποστολή μηνύματος" onPress={() => void buildDraft()} busy={busy} />
          {offer.status !== 'sent_manually' && offer.status !== 'accepted' ? (
            <PrimaryButton label="Σήμανση: Στάλθηκε" tone="outline" busy={busy} onPress={() => void setStatus('sent_manually')} />
          ) : null}
          {offer.status !== 'accepted' ? (
            <PrimaryButton label="Σήμανση: Αποδεκτή" tone="outline" busy={busy} onPress={() => void setStatus('accepted')} />
          ) : null}
          {offer.status !== 'rejected' ? (
            <PrimaryButton label="Σήμανση: Απορρίφθηκε" tone="outline" busy={busy} onPress={() => void setStatus('rejected')} />
          ) : null}
        </>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  items: { gap: Spacing.two },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, backgroundColor: '#F7F9FB', borderRadius: 12, padding: Spacing.three },
  itemDesc: { flex: 1, gap: 2 },
  totals: { alignItems: 'flex-end', gap: 2 },
  total: { fontSize: 17, color: '#0A1120' },
  msgBox: { backgroundColor: '#F7F9FB', borderRadius: 14, padding: Spacing.three },
  dark: { color: '#0A1120' },
});
