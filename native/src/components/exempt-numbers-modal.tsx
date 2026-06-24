// Call EXEMPTION list (#9): pick contacts that must NOT hear the «η κλήση
// ηχογραφείται» message and must NOT be recorded (the owner's personal contacts).
// Two modes inside one sheet: (1) the current exempt list with per-row remove, and
// (2) a device-contacts picker with search + «Επιλογή όλων» that POSTs the chosen
// numbers. Backend: /api/businesses/me/exempt-numbers (GET/POST/DELETE), last-10
// normalized. Mirrors the importContacts permission/read pattern.

import { Ionicons } from '@expo/vector-icons';
import * as Contacts from 'expo-contacts';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiDelete, apiGet, apiPost } from '@/lib/api';

type ExemptRow = { phone: string; label: string | null };
type Candidate = { phone: string; label: string };

const last10 = (s?: string | null) => (s ? s.replace(/\D/g, '').slice(-10) : '');
const fmt = (p: string) => (p.length === 10 ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p);

export function ExemptNumbersModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useTheme();
  const styles = makeStyles(c);

  const [list, setList] = useState<ExemptRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Picker mode
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    try {
      const r = await apiGet<{ ok?: boolean; numbers?: ExemptRow[]; migrationPending?: boolean }>('/api/businesses/me/exempt-numbers');
      setList(r?.numbers ?? []);
      if (r?.migrationPending) {
        Alert.alert('Λίστα εξαιρέσεων', 'Η λειτουργία ενεργοποιείται μόλις εφαρμοστεί η αναβάθμιση βάσης (migration 060).');
      }
    } catch {
      Alert.alert('Σφάλμα', 'Δεν φορτώθηκε η λίστα.');
    } finally {
      setLoading(false);
    }
  }

  // Load (and reset picker state) each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setPicking(false);
    setSearch('');
    setSelected(new Set());
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function openPicker() {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Επαφές', 'Χρειάζεται άδεια πρόσβασης στις επαφές.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name] });
      const existing = new Set(list.map((r) => r.phone));
      const seen = new Set<string>();
      const out: Candidate[] = [];
      for (const ct of data) {
        const name = ct.name?.trim() || '';
        if (!ct.phoneNumbers) continue;
        for (const p of ct.phoneNumbers) {
          const d = last10(p.number);
          if (d.length === 10 && !seen.has(d) && !existing.has(d)) {
            seen.add(d);
            out.push({ phone: d, label: name });
          }
        }
      }
      out.sort((a, b) => a.label.localeCompare(b.label, 'el'));
      setCandidates(out);
      setSelected(new Set());
      setSearch('');
      setPicking(true);
    } catch {
      Alert.alert('Σφάλμα', 'Δεν διαβάστηκαν οι επαφές.');
    } finally {
      setBusy(false);
    }
  }

  const filtered = search.trim()
    ? candidates.filter((x) => x.label.toLowerCase().includes(search.trim().toLowerCase()) || x.phone.includes(search.replace(/\D/g, '')))
    : candidates;
  const allSelected = filtered.length > 0 && filtered.every((x) => selected.has(x.phone));

  function toggle(phone: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone); else next.add(phone);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) filtered.forEach((x) => next.delete(x.phone));
      else filtered.forEach((x) => next.add(x.phone));
      return next;
    });
  }

  async function confirmAdd() {
    const numbers = candidates.filter((x) => selected.has(x.phone)).map((x) => ({ phone: x.phone, label: x.label }));
    if (numbers.length === 0) { setPicking(false); return; }
    setBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean; added?: number; error?: string }>('/api/businesses/me/exempt-numbers', { numbers });
      if (r?.ok) { setPicking(false); await load(); }
      else Alert.alert('Σφάλμα', r?.error === 'migration_pending' ? 'Χρειάζεται η αναβάθμιση βάσης (migration 060).' : 'Δεν προστέθηκαν.');
    } catch {
      Alert.alert('Σφάλμα', 'Δεν προστέθηκαν.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(phone: string) {
    setBusy(true);
    try {
      await apiDelete(`/api/businesses/me/exempt-numbers?phone=${encodeURIComponent(phone)}`);
      await load();
    } catch {
      Alert.alert('Σφάλμα', 'Δεν αφαιρέθηκε.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetModal visible={visible} title="Εξαιρέσεις ηχογράφησης" onClose={onClose}>
      {picking ? (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Διάλεξε επαφές που ΔΕΝ θα ακούν το μήνυμα ηχογράφησης και ΔΕΝ θα ηχογραφούνται.
          </ThemedText>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Αναζήτηση επαφής…"
            placeholderTextColor={c.textFaint}
            style={styles.search}
          />
          <Pressable onPress={toggleAll} style={styles.selectAll}>
            <Ionicons name={allSelected ? 'checkbox' : 'square-outline'} size={22} color={Brand.primary} />
            <ThemedText type="smallBold" style={styles.rowName}>Επιλογή όλων ({filtered.length})</ThemedText>
          </Pressable>
          {filtered.slice(0, 300).map((x) => {
            const on = selected.has(x.phone);
            return (
              <Pressable key={x.phone} onPress={() => toggle(x.phone)} style={styles.row}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? Brand.primary : c.textFaint} />
                <View style={styles.rowText}>
                  <ThemedText type="small" style={styles.rowName} numberOfLines={1}>{x.label || fmt(x.phone)}</ThemedText>
                  {x.label ? <ThemedText type="small" themeColor="textSecondary">{fmt(x.phone)}</ThemedText> : null}
                </View>
              </Pressable>
            );
          })}
          {filtered.length > 300 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>Δείχνονται οι πρώτες 300 — χρησιμοποίησε την αναζήτηση.</ThemedText>
          ) : null}
          <PrimaryButton label={`Προσθήκη (${selected.size})`} busy={busy} disabled={selected.size === 0} onPress={() => void confirmAdd()} />
          <PrimaryButton label="Πίσω" tone="outline" onPress={() => setPicking(false)} />
        </View>
      ) : (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Οι αριθμοί εδώ δεν ακούν «η κλήση ηχογραφείται» και δεν ηχογραφούνται — για προσωπικές επαφές που σε καλούν στο ίδιο νούμερο.
          </ThemedText>
          {loading ? (
            <ActivityIndicator color={Brand.primary} style={{ marginVertical: Spacing.three }} />
          ) : list.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>Καμία εξαίρεση ακόμη.</ThemedText>
          ) : (
            list.map((r) => (
              <View key={r.phone} style={styles.row}>
                <View style={styles.rowText}>
                  <ThemedText type="small" style={styles.rowName} numberOfLines={1}>{r.label || fmt(r.phone)}</ThemedText>
                  {r.label ? <ThemedText type="small" themeColor="textSecondary">{fmt(r.phone)}</ThemedText> : null}
                </View>
                <Pressable onPress={() => void remove(r.phone)} hitSlop={10} disabled={busy}>
                  <Ionicons name="trash-outline" size={20} color={Brand.danger} />
                </Pressable>
              </View>
            ))
          )}
          <PrimaryButton label="Προσθήκη από επαφές" busy={busy} onPress={() => void openPicker()} />
        </View>
      )}
    </SheetModal>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  section: { gap: Spacing.three },
  search: { borderWidth: 1, borderColor: c.borderFaint, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 10, color: c.text },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderFaint },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { color: c.text },
  note: { marginVertical: Spacing.two },
});
