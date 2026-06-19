// Ρυθμίσεις — web parity sections: Επιχείρηση (businesses/me), Τηλεφωνία,
// Κατάλογος υπηρεσιών (/api/catalog CRUD), Λογαριασμός. Data/Ειδοποιήσεις → web.

import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Input, ListRow, PrimaryButton, Section } from '@/components/ui';
import { BottomTabInset, Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useThemeMode } from '@/lib/theme-mode';
import { formatDate, formatEuro } from '@/lib/format';
import { getIncomingState } from '@/lib/twilio-state';
import type { Business, CatalogItem } from '@/lib/types';
import DisclosureRecorderModal from '@/components/disclosure-recorder-modal';

const PHONE_LABEL: Record<string, string> = {
  idle: 'Μη συνδεδεμένο',
  registering: 'Σύνδεση…',
  registered: 'Συνδεδεμένο ✓',
  error: 'Σφάλμα',
};

interface Snippet { id: string; title: string; body: string }
interface BankAccount { id: string; beneficiary: string | null; bankName: string | null; iban: string; sortOrder: number }

const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

const DEFAULT_AUTO_REPLY = 'Γεια σας! Λάβαμε την κλήση σας εκτός ωραρίου. Θα σας καλέσουμε το συντομότερο δυνατό. Ευχαριστούμε!';
const WEEK_DAYS: Array<{ n: number; label: string }> = [
  { n: 1, label: 'Δε' }, { n: 2, label: 'Τρ' }, { n: 3, label: 'Τε' },
  { n: 4, label: 'Πε' }, { n: 5, label: 'Πα' }, { n: 6, label: 'Σα' }, { n: 7, label: 'Κυ' },
];

interface MessagingSettings {
  businessHours: { days: number[]; open: string; close: string } | null;
  autoReplyEnabled: boolean;
  autoReplyText: string | null;
  weeklySummaryEnabled: boolean;
}

const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', team: 'Team' };
const SUB_STATUS: Record<string, string> = {
  trialing: 'Δοκιμή',
  active: 'Ενεργό',
  pending_manual_review: 'Σε αξιολόγηση',
  cancelled: 'Ακυρωμένο',
  past_due: 'Εκκρεμεί πληρωμή',
};

export default function SettingsScreen() {
  const { session, signOut } = useAuth();
  const email = session?.user?.email ?? '';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const { isDark, setDark } = useThemeMode();

  // ----- subscription (read-only view) + account deletion (store requirement) -----
  const [sub, setSub] = useState<{ plan_key: string; status: string; trial_ends_at: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingImported, setDeletingImported] = useState(false);

  function confirmDeleteImported() {
    Alert.alert(
      'Διαγραφή εισαγόμενων επαφών',
      'Θα διαγραφούν όλες οι επαφές που εισήχθησαν από το κινητό. Οι επαφές της εφαρμογής (κλήσεις, έργα, χειροκίνητες) δεν επηρεάζονται. Συνέχεια;',
      [
        { text: 'Άκυρο', style: 'cancel' },
        {
          text: 'Διαγραφή',
          style: 'destructive',
          onPress: async () => {
            setDeletingImported(true);
            try {
              const r = await apiDelete<{ ok?: boolean; deleted?: number }>('/api/customers/imported');
              Alert.alert('✓', `Διαγράφηκαν ${r?.deleted ?? 0} εισαγόμενες επαφές.`);
            } catch {
              Alert.alert('Σφάλμα', 'Η διαγραφή απέτυχε. Δοκίμασε ξανά.');
            } finally {
              setDeletingImported(false);
            }
          },
        },
      ],
    );
  }
  useEffect(() => {
    let on = true;
    apiGet<{ subscription?: { plan_key: string; status: string; trial_ends_at: string | null } | null }>('/api/businesses/me')
      .then((r) => { if (on) setSub(r?.subscription ?? null); })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  const doDeleteAccount = useCallback(async () => {
    setDeleting(true);
    try {
      await apiPost('/api/account/delete', {});
      await signOut();
    } catch {
      Alert.alert('Σφάλμα', 'Η διαγραφή απέτυχε. Δοκίμασε ξανά.');
      setDeleting(false);
    }
  }, [signOut]);

  const confirmDeleteAccount = useCallback(() => {
    Alert.alert(
      'Διαγραφή λογαριασμού',
      'Θα διαγραφούν οριστικά η επιχείρηση και ΟΛΑ τα δεδομένα σου (πελάτες, προσφορές, κλήσεις, ραντεβού). Δεν αναιρείται. Συνέχεια;',
      [
        { text: 'Ακύρωση', style: 'cancel' },
        { text: 'Διαγραφή', style: 'destructive', onPress: () => void doDeleteAccount() },
      ],
    );
  }, [doDeleteAccount]);

  const [phone, setPhone] = useState(getIncomingState());
  const [discModal, setDiscModal] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setPhone(getIncomingState()), 1500);
    return () => clearInterval(t);
  }, []);
  const phoneValue = phone.state === 'error' ? `Σφάλμα: ${phone.detail ?? ''}` : PHONE_LABEL[phone.state];

  // ----- business profile -----
  const [biz, setBiz] = useState<Business | null>(null);
  const [bizForm, setBizForm] = useState<Record<string, string>>({});
  const [bizBusy, setBizBusy] = useState(false);

  // ----- bank accounts (multiple, α; primary = first, mirrored to businesses.bank_*) -----
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [bankBusy, setBankBusy] = useState(false);
  const [baForm, setBaForm] = useState<{ beneficiary: string; bank: string; iban: string }>({ beneficiary: '', bank: '', iban: '' });
  const [baEditId, setBaEditId] = useState<string | null>(null);

  // ----- catalog -----
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catName, setCatName] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catUnit, setCatUnit] = useState('');
  const [catPrice, setCatPrice] = useState('');
  const [catVat, setCatVat] = useState('24');
  const [catBusy, setCatBusy] = useState(false);

  // ----- snippets (message templates) -----
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [snTitle, setSnTitle] = useState('');
  const [snBody, setSnBody] = useState('');
  const [snEditId, setSnEditId] = useState<string | null>(null);
  const [snBusy, setSnBusy] = useState(false);

  // ----- automations (hours / auto-reply / weekly summary) -----
  const [autoLoaded, setAutoLoaded] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [autoReplyText, setAutoReplyText] = useState(DEFAULT_AUTO_REPLY);
  const [hoursEnabled, setHoursEnabled] = useState(false);
  const [hoursDays, setHoursDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [hoursOpen, setHoursOpen] = useState('09:00');
  const [hoursClose, setHoursClose] = useState('18:00');
  const [weeklyEnabled, setWeeklyEnabled] = useState(true);
  const [autoBusy, setAutoBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [b, c, sn, ms, bk] = await Promise.all([
        apiGet<{ ok?: boolean; business?: Business }>('/api/businesses/me'),
        apiGet<{ ok?: boolean; items?: CatalogItem[] }>('/api/catalog'),
        apiGet<{ ok?: boolean; snippets?: Snippet[] }>('/api/snippets'),
        apiGet<{ ok?: boolean; settings?: MessagingSettings }>('/api/businesses/me/messaging-settings'),
        apiGet<{ ok?: boolean; accounts?: BankAccount[] }>('/api/businesses/me/bank-accounts'),
      ]);
      setSnippets(sn?.snippets ?? []);
      if (ms?.settings) {
        const s = ms.settings;
        if (s.businessHours) {
          setHoursEnabled(true);
          setHoursDays(s.businessHours.days);
          setHoursOpen(s.businessHours.open);
          setHoursClose(s.businessHours.close);
        }
        setAutoReplyEnabled(s.autoReplyEnabled);
        if (s.autoReplyText) setAutoReplyText(s.autoReplyText);
        setWeeklyEnabled(s.weeklySummaryEnabled);
        setAutoLoaded(true);
      }
      if (b?.business) {
        setBiz(b.business);
        setBizForm({
          name: b.business.name ?? '',
          legal_name: b.business.legal_name ?? '',
          trade_name: b.business.trade_name ?? '',
          owner_first_name: b.business.owner_first_name ?? '',
          owner_last_name: b.business.owner_last_name ?? '',
          phone: b.business.phone ?? '',
          email: b.business.email ?? '',
          website: b.business.website ?? '',
          facebook_url: b.business.facebook_url ?? '',
          instagram_url: b.business.instagram_url ?? '',
          address: b.business.address ?? '',
          address_line1: b.business.address_line1 ?? '',
          address_line2: b.business.address_line2 ?? '',
          postal_code: b.business.postal_code ?? '',
          region: b.business.region ?? '',
          city: b.business.city ?? '',
          vat_number: b.business.vat_number ?? '',
          tax_office: b.business.tax_office ?? '',
          default_vat_rate: b.business.default_vat_rate != null ? String(b.business.default_vat_rate) : '24',
          default_offer_terms: b.business.default_offer_terms ?? '',
          default_acceptance_text: b.business.default_acceptance_text ?? '',
        });
      }
      setCatalog(c?.items ?? []);
      setAccounts(bk?.accounts ?? []);
    } catch {
      // sections show empty states; pull of the screen retries on remount
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setB = (k: string) => (v: string) => setBizForm((f) => ({ ...f, [k]: v }));
  const setBa = (k: 'beneficiary' | 'bank' | 'iban') => (v: string) =>
    setBaForm((f) => ({ ...f, [k]: k === 'iban' ? v.toUpperCase() : v }));

  async function saveBusiness() {
    // GUARD: if the initial load failed, the form is empty — saving it would
    // null out the real business profile on the server.
    if (!biz) {
      Alert.alert('Σφάλμα', 'Τα στοιχεία δεν έχουν φορτωθεί ακόμα — κάνε ανανέωση και δοκίμασε ξανά.');
      return;
    }
    setBizBusy(true);
    try {
      const vat = parseFloat((bizForm.default_vat_rate ?? '24').replace(',', '.'));
      // Sanitise so the server's website/postal_code validators never 400 the
      // whole save: add a scheme to a bare domain; drop a postal code that isn't
      // exactly 5 digits.
      const wRaw = (bizForm.website ?? '').trim();
      const website = wRaw ? (/^https?:\/\//.test(wRaw) ? wRaw : `https://${wRaw}`) : null;
      const pcRaw = (bizForm.postal_code ?? '').trim();
      const postalCode = /^\d{5}$/.test(pcRaw) ? pcRaw : null;
      const res = await apiPatch<{ ok?: boolean }>('/api/businesses/me', {
        name: bizForm.name || null,
        // The PATCH route requires type + preferred_contact_method; preserve the
        // loaded values (this form doesn't edit them) so the save isn't rejected.
        type: biz.type || 'other',
        preferred_contact_method: biz.preferred_contact_method || 'phone',
        legal_name: bizForm.legal_name || null,
        trade_name: bizForm.trade_name || null,
        owner_first_name: bizForm.owner_first_name || null,
        owner_last_name: bizForm.owner_last_name || null,
        phone: bizForm.phone || null,
        email: bizForm.email || null,
        website,
        facebook_url: bizForm.facebook_url || null,
        instagram_url: bizForm.instagram_url || null,
        address: bizForm.address || null,
        address_line1: bizForm.address_line1 || null,
        address_line2: bizForm.address_line2 || null,
        postal_code: postalCode,
        region: bizForm.region || null,
        city: bizForm.city || null,
        vat_number: bizForm.vat_number || null,
        tax_office: bizForm.tax_office || null,
        default_vat_rate: Number.isFinite(vat) ? vat : 24,
        default_offer_terms: bizForm.default_offer_terms || null,
        default_acceptance_text: bizForm.default_acceptance_text || null,
      });
      if (res?.ok) Alert.alert('✓', 'Αποθηκεύτηκε.');
      else Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setBizBusy(false);
    }
  }

  function resetBankForm() {
    setBaForm({ beneficiary: '', bank: '', iban: '' });
    setBaEditId(null);
  }

  function editAccount(a: BankAccount) {
    setBaEditId(a.id);
    setBaForm({ beneficiary: a.beneficiary ?? '', bank: a.bankName ?? '', iban: a.iban });
  }

  // Add (POST) or update (PATCH) a bank account. First account = primary, mirrored
  // server-side into businesses.bank_* (payment card / offer keep reading those).
  async function saveAccount() {
    const normIban = (baForm.iban ?? '').replace(/\s+/g, '').toUpperCase();
    if (!IBAN_RE.test(normIban)) {
      Alert.alert('Μη έγκυρο IBAN', 'Έλεγξε τη μορφή του IBAN (π.χ. GR16 0110 1250 0000 0001 2300 695).');
      return;
    }
    setBankBusy(true);
    try {
      const payload = { beneficiary: baForm.beneficiary.trim() || null, bank: baForm.bank.trim() || null, iban: normIban };
      const res = baEditId
        ? await apiPatch<{ ok?: boolean }>(`/api/businesses/me/bank-accounts/${baEditId}`, payload)
        : await apiPost<{ ok?: boolean }>('/api/businesses/me/bank-accounts', payload);
      if (res?.ok) {
        resetBankForm();
        void load();
        Alert.alert('✓', 'Αποθηκεύτηκε.');
      } else {
        Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
      }
    } catch (e) {
      const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : undefined;
      if (e instanceof ApiError && (e.status === 400 || code === 'invalid_iban')) {
        Alert.alert('Μη έγκυρο IBAN', 'Το IBAN δεν είναι έγκυρο.');
      } else if (e instanceof ApiError && (e.status === 503 || code === 'bank_unavailable')) {
        Alert.alert('Δεν είναι διαθέσιμο', 'Αυτή η λειτουργία δεν είναι ακόμα διαθέσιμη. Δοκίμασε ξανά σύντομα.');
      } else if (e instanceof ApiError && e.isNetwork) {
        Alert.alert('Σφάλμα', 'Έλεγξε τη σύνδεση και δοκίμασε ξανά.');
      } else {
        Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
      }
    } finally {
      setBankBusy(false);
    }
  }

  function deleteAccount(a: BankAccount) {
    Alert.alert('Διαγραφή λογαριασμού', `Να διαγραφεί ο λογαριασμός ${a.iban};`, [
      { text: 'Ακύρωση', style: 'cancel' },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: async () => {
          try {
            const r = await apiDelete<{ ok?: boolean }>(`/api/businesses/me/bank-accounts/${a.id}`);
            if (r?.ok) {
              if (baEditId === a.id) resetBankForm();
              void load();
            } else Alert.alert('Σφάλμα', 'Δεν διαγράφηκε.');
          } catch {
            Alert.alert('Σφάλμα', 'Δεν διαγράφηκε.');
          }
        },
      },
    ]);
  }

  async function addCatalogItem() {
    if (!catName.trim()) {
      Alert.alert('Κατάλογος', 'Συμπλήρωσε όνομα υπηρεσίας/υλικού.');
      return;
    }
    setCatBusy(true);
    try {
      const res = await apiPost<{ ok?: boolean; item?: CatalogItem; error?: string }>('/api/catalog', {
        name: catName.trim(),
        code: catCode.trim() || null,
        unit: catUnit.trim() || null,
        unitPrice: parseFloat(catPrice.replace(',', '.')) || 0,
        vatRate: parseFloat(catVat.replace(',', '.')) || 24,
      });
      if (res?.ok) {
        setCatName('');
        setCatCode('');
        setCatUnit('');
        setCatPrice('');
        void load();
      } else {
        Alert.alert('Σφάλμα', res?.error === 'duplicate_code' ? 'Υπάρχει ήδη είδος με αυτόν τον κωδικό.' : 'Η προσθήκη απέτυχε.');
      }
    } catch {
      Alert.alert('Σφάλμα', 'Η προσθήκη απέτυχε.');
    } finally {
      setCatBusy(false);
    }
  }

  // ----- snippets CRUD -----
  async function saveSnippet() {
    if (!snTitle.trim() || !snBody.trim() || snBusy) return;
    setSnBusy(true);
    try {
      if (snEditId) {
        const res = await apiPatch<{ ok?: boolean }>(`/api/snippets/${snEditId}`, { title: snTitle.trim(), body: snBody.trim() });
        if (!res?.ok) throw new Error();
      } else {
        const res = await apiPost<{ ok?: boolean }>('/api/snippets', { title: snTitle.trim(), body: snBody.trim() });
        if (!res?.ok) throw new Error();
      }
      setSnTitle('');
      setSnBody('');
      setSnEditId(null);
      void load();
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setSnBusy(false);
    }
  }

  function onSnippetTap(s: Snippet) {
    Alert.alert(s.title, undefined, [
      { text: 'Επεξεργασία', onPress: () => { setSnEditId(s.id); setSnTitle(s.title); setSnBody(s.body); } },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: async () => {
          setSnippets((prev) => prev.filter((x) => x.id !== s.id));
          try { await apiDelete(`/api/snippets/${s.id}`); } catch { void load(); }
        },
      },
      { text: 'Άκυρο', style: 'cancel' },
    ]);
  }

  // ----- automations save -----
  function toggleHoursDay(n: number) {
    setHoursDays((prev) => (prev.includes(n) ? prev.filter((d) => d !== n) : [...prev, n].sort()));
  }

  async function saveAutomations() {
    setAutoBusy(true);
    try {
      const res = await apiPatch<{ ok?: boolean; hint?: string }>('/api/businesses/me/messaging-settings', {
        businessHours: hoursEnabled && hoursDays.length > 0 ? { days: hoursDays, open: hoursOpen, close: hoursClose } : null,
        autoReplyEnabled,
        autoReplyText: autoReplyText.trim() || null,
        weeklySummaryEnabled: weeklyEnabled,
      });
      if (res?.ok) Alert.alert('✓', 'Αποθηκεύτηκε.');
      else Alert.alert('Σφάλμα', res?.hint === 'migration_044_pending' ? 'Η βάση δεν είναι ακόμη έτοιμη γι’ αυτό.' : 'Η αποθήκευση απέτυχε.');
    } catch {
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
    } finally {
      setAutoBusy(false);
    }
  }

  function deleteCatalogItem(item: CatalogItem) {
    Alert.alert('Διαγραφή', `Διαγραφή «${item.name}»;`, [
      { text: 'Ακύρωση', style: 'cancel' },
      {
        text: 'Διαγραφή',
        style: 'destructive',
        onPress: async () => {
          setCatalog((c) => c.filter((x) => x.id !== item.id));
          try {
            await apiDelete(`/api/catalog/${item.id}`);
          } catch {
            void load();
          }
        },
      },
    ]);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ThemedText type="subtitle" style={styles.title}>
          Ρυθμίσεις
        </ThemedText>

        <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Λογαριασμός header */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.profile}>
              <View style={styles.avatar}>
                <ThemedText style={styles.avatarText}>{(email || 'O').slice(0, 1).toUpperCase()}</ThemedText>
              </View>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">{biz?.name ?? 'Λογαριασμός'}</ThemedText>
                {email ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {email}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          </ThemedView>

          {/* ───── Η επιχείρησή σου ───── */}
          <GroupHeader title="Η επιχείρησή σου" />

          {/* Επιχείρηση */}
          <Section title="Επιχείρηση">
            <Input label="Όνομα επιχείρησης" value={bizForm.name ?? ''} onChangeText={setB('name')} />
            <Input label="Επωνυμία (νομική)" value={bizForm.legal_name ?? ''} onChangeText={setB('legal_name')} />
            <Input label="Διακριτικός τίτλος" value={bizForm.trade_name ?? ''} onChangeText={setB('trade_name')} />
            <View style={styles.bankEditRow}>
              <View style={{ flex: 1 }}><Input label="Όνομα υπευθύνου" value={bizForm.owner_first_name ?? ''} onChangeText={setB('owner_first_name')} /></View>
              <View style={{ flex: 1 }}><Input label="Επώνυμο υπευθύνου" value={bizForm.owner_last_name ?? ''} onChangeText={setB('owner_last_name')} /></View>
            </View>
            <Input label="Τηλέφωνο" value={bizForm.phone ?? ''} onChangeText={setB('phone')} keyboardType="phone-pad" />
            <Input label="Email" value={bizForm.email ?? ''} onChangeText={setB('email')} keyboardType="email-address" />
            <Input label="Ιστότοπος" value={bizForm.website ?? ''} onChangeText={setB('website')} placeholder="https://…" />
            <Input label="Facebook (URL)" value={bizForm.facebook_url ?? ''} onChangeText={setB('facebook_url')} />
            <Input label="Instagram (URL ή @handle)" value={bizForm.instagram_url ?? ''} onChangeText={setB('instagram_url')} />
            <Input label="Διεύθυνση" value={bizForm.address_line1 ?? bizForm.address ?? ''} onChangeText={setB('address_line1')} />
            <Input label="Διεύθυνση (2η γραμμή)" value={bizForm.address_line2 ?? ''} onChangeText={setB('address_line2')} />
            <View style={styles.bankEditRow}>
              <View style={{ flex: 1 }}><Input label="Τ.Κ." value={bizForm.postal_code ?? ''} onChangeText={setB('postal_code')} keyboardType="numeric" /></View>
              <View style={{ flex: 1 }}><Input label="Περιοχή" value={bizForm.region ?? ''} onChangeText={setB('region')} /></View>
            </View>
            <Input label="Πόλη" value={bizForm.city ?? ''} onChangeText={setB('city')} />
            <Input label="ΑΦΜ" value={bizForm.vat_number ?? ''} onChangeText={setB('vat_number')} />
            <Input label="Δ.Ο.Υ." value={bizForm.tax_office ?? ''} onChangeText={setB('tax_office')} />
            <Input label="ΦΠΑ % (προεπιλογή)" value={bizForm.default_vat_rate ?? ''} onChangeText={setB('default_vat_rate')} keyboardType="decimal-pad" />
            <Input label="Όροι προσφοράς (προεπιλογή)" value={bizForm.default_offer_terms ?? ''} onChangeText={setB('default_offer_terms')} multiline />
            <Input label="Κείμενο αποδοχής προσφοράς" value={bizForm.default_acceptance_text ?? ''} onChangeText={setB('default_acceptance_text')} multiline />
            <ThemedText type="small" themeColor="textSecondary">Το λογότυπο ανεβαίνει από το web (opiflow.ai → Ρυθμίσεις).</ThemedText>
            <PrimaryButton label="Αποθήκευση" onPress={() => void saveBusiness()} busy={bizBusy} disabled={!biz} />
          </Section>

          {/* Τραπεζικά στοιχεία (πολλαπλοί λογαριασμοί, α) */}
          <Section title="Τραπεζικά στοιχεία" count={accounts.length}>
            <ThemedText type="small" themeColor="textSecondary">
              Εμφανίζονται στον πελάτη όταν του ζητάς κατάθεση/εξόφληση και στην προσφορά. Ο πρώτος λογαριασμός είναι ο κύριος. Το Opiflow δεν διαχειρίζεται χρήματα — ο πελάτης καταθέτει απευθείας σε εσένα.
            </ThemedText>
            {accounts.map((a, i) => (
              <ListRow
                key={a.id}
                title={`${a.iban}${i === 0 ? '  ·  Κύριος' : ''}`}
                subtitle={[a.beneficiary, a.bankName].filter(Boolean).join(' · ') || '—'}
                onPress={() => editAccount(a)}
              />
            ))}
            <ThemedText type="smallBold" style={styles.subhead}>
              {baEditId ? 'Επεξεργασία λογαριασμού' : 'Προσθήκη λογαριασμού'}
            </ThemedText>
            <Input label="Δικαιούχος" value={baForm.beneficiary} onChangeText={setBa('beneficiary')} placeholder="π.χ. Γεώργιος Παπαδόπουλος" />
            <Input label="Τράπεζα" value={baForm.bank} onChangeText={setBa('bank')} placeholder="π.χ. Εθνική Τράπεζα" />
            <Input label="IBAN" value={baForm.iban} onChangeText={setBa('iban')} placeholder="GR16 0110 1250 0000 0001 2300 695" />
            <PrimaryButton label={baEditId ? 'Αποθήκευση' : 'Προσθήκη λογαριασμού'} onPress={() => void saveAccount()} busy={bankBusy} />
            {baEditId ? (
              <View style={styles.bankEditRow}>
                <View style={styles.bankEditCol}>
                  <PrimaryButton
                    label="Διαγραφή"
                    tone="outline"
                    onPress={() => {
                      const a = accounts.find((x) => x.id === baEditId);
                      if (a) deleteAccount(a);
                    }}
                  />
                </View>
                <View style={styles.bankEditCol}>
                  <PrimaryButton label="Άκυρο" tone="outline" onPress={resetBankForm} />
                </View>
              </View>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              Tip: πάτησε έναν λογαριασμό για επεξεργασία ή διαγραφή.
            </ThemedText>
          </Section>

          {/* Κατάλογος υπηρεσιών */}
          <Section title="Κατάλογος υπηρεσιών" count={catalog.length}>
            {catalog.map((it) => (
              <ListRow
                key={it.id}
                title={`${it.code ? `${it.code} · ` : ''}${it.name}`}
                subtitle={`${formatEuro(it.unitPrice)}${it.unit ? ` / ${it.unit}` : ''} · ΦΠΑ ${it.vatRate}%`}
                onPress={() => deleteCatalogItem(it)}
              />
            ))}
            <ThemedText type="smallBold" style={styles.subhead}>
              Προσθήκη είδους
            </ThemedText>
            <Input label="Όνομα υπηρεσίας/υλικού" value={catName} onChangeText={setCatName} />
            <View style={styles.catRow}>
              <View style={styles.catCol}>
                <Input label="Κωδ." value={catCode} onChangeText={setCatCode} />
              </View>
              <View style={styles.catCol}>
                <Input label="Μον." value={catUnit} onChangeText={setCatUnit} placeholder="τεμ." />
              </View>
              <View style={styles.catCol}>
                <Input label="€" value={catPrice} onChangeText={setCatPrice} keyboardType="decimal-pad" />
              </View>
              <View style={styles.catCol}>
                <Input label="ΦΠΑ%" value={catVat} onChangeText={setCatVat} keyboardType="decimal-pad" />
              </View>
            </View>
            <PrimaryButton label="Προσθήκη" onPress={() => void addCatalogItem()} busy={catBusy} />
            <ThemedText type="small" themeColor="textSecondary">
              Tip: πάτησε ένα είδος για διαγραφή. Ο κατάλογος τροφοδοτεί τις προτάσεις στη «Νέα προσφορά».
            </ThemedText>
          </Section>

          {/* ───── Επικοινωνία με πελάτες ───── */}
          <GroupHeader title="Επικοινωνία με πελάτες" />

          {/* Τηλεφωνία */}
          <Section title="Τηλεφωνία" initiallyOpen>
            <Row label="Ο αριθμός σου" value={biz?.business_phone_number ?? '—'} />
            <Row label="Τηλέφωνο app (εισερχόμενες)" value={phoneValue} />
            <PrimaryButton
              label="Επανασύνδεση τηλεφώνου"
              tone="outline"
              onPress={async () => {
                const { registerForIncoming } = await import('@/lib/twilio');
                void registerForIncoming();
              }}
            />
            <View style={{ height: 12 }} />
            <ThemedText type="smallBold">Μήνυμα ηχογράφησης κλήσεων</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Ηχογράφησέ το με τη φωνή σου — ακούγεται στον πελάτη πριν από κάθε κλήση.
            </ThemedText>
            <PrimaryButton label="Ηχογράφηση τώρα" tone="outline" onPress={() => setDiscModal(true)} />
            <DisclosureRecorderModal
              visible={discModal}
              onClose={(saved) => { setDiscModal(false); if (saved) Alert.alert('✓', 'Το μήνυμα ηχογράφησης αποθηκεύτηκε.'); }}
            />
          </Section>

          {/* Πρότυπα μηνυμάτων */}
          <Section title="Πρότυπα μηνυμάτων" count={snippets.length}>
            {snippets.map((s) => (
              <ListRow key={s.id} title={s.title} subtitle={s.body} onPress={() => onSnippetTap(s)} />
            ))}
            <ThemedText type="smallBold" style={styles.subhead}>
              {snEditId ? 'Επεξεργασία προτύπου' : 'Νέο πρότυπο'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Μπορείς να βάλεις {'{όνομα}'}, {'{ημερομηνία}'}, {'{ώρα}'}, {'{διεύθυνση}'} — συμπληρώνονται αυτόματα.
            </ThemedText>
            <Input label="Τίτλος" value={snTitle} onChangeText={setSnTitle} placeholder="π.χ. Ερχόμαστε σύντομα" />
            <Input label="Κείμενο" value={snBody} onChangeText={setSnBody} multiline />
            <View style={styles.inlineBtns}>
              <View style={{ flex: 1 }}>
                <PrimaryButton label={snEditId ? 'Αποθήκευση' : 'Προσθήκη'} onPress={() => void saveSnippet()} busy={snBusy} disabled={!snTitle.trim() || !snBody.trim()} />
              </View>
              {snEditId ? (
                <View style={{ flex: 1 }}>
                  <PrimaryButton label="Άκυρο" tone="outline" onPress={() => { setSnEditId(null); setSnTitle(''); setSnBody(''); }} />
                </View>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Tip: πάτησε ένα πρότυπο για επεξεργασία ή διαγραφή. Τα πρότυπα μπαίνουν με ένα tap στη συνομιλία.
            </ThemedText>
          </Section>

          {/* Ωράριο & αυτοματισμοί */}
          <Section title="Ωράριο & αυτοματισμοί">
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Αυτόματη απάντηση σε αναπάντητη</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Εκτός ωραρίου, ο πελάτης λαμβάνει αυτόματο μήνυμα (Viber → SMS).
                </ThemedText>
              </View>
              <Switch value={autoReplyEnabled} onValueChange={setAutoReplyEnabled} trackColor={{ true: Brand.primary }} />
            </View>
            {autoReplyEnabled ? (
              <Input label="Μήνυμα" value={autoReplyText} onChangeText={setAutoReplyText} multiline />
            ) : null}

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Ωράριο λειτουργίας</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Καθορίζει το «εκτός ωραρίου». Χωρίς ωράριο, στέλνεται σε κάθε αναπάντητη.
                </ThemedText>
              </View>
              <Switch value={hoursEnabled} onValueChange={setHoursEnabled} trackColor={{ true: Brand.primary }} />
            </View>
            {hoursEnabled ? (
              <>
                <View style={styles.dayRow}>
                  {WEEK_DAYS.map((d) => (
                    <Pressable
                      key={d.n}
                      onPress={() => toggleHoursDay(d.n)}
                      style={({ pressed }) => [styles.dayChip, hoursDays.includes(d.n) && styles.dayChipOn, pressed && styles.pressed]}>
                      <ThemedText type="small" style={hoursDays.includes(d.n) ? styles.dayChipOnText : styles.dayChipText}>
                        {d.label}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.catRow}>
                  <View style={styles.catCol}>
                    <Input label="Από (ΩΩ:ΛΛ)" value={hoursOpen} onChangeText={setHoursOpen} placeholder="09:00" />
                  </View>
                  <View style={styles.catCol}>
                    <Input label="Έως (ΩΩ:ΛΛ)" value={hoursClose} onChangeText={setHoursClose} placeholder="18:00" />
                  </View>
                </View>
              </>
            ) : null}

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Εβδομαδιαία σύνοψη</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Μία ειδοποίηση τη βδομάδα: κλήσεις, αναπάντητες, εκκρεμότητες.
                </ThemedText>
              </View>
              <Switch value={weeklyEnabled} onValueChange={setWeeklyEnabled} trackColor={{ true: Brand.primary }} />
            </View>

            <PrimaryButton label="Αποθήκευση" onPress={() => void saveAutomations()} busy={autoBusy} disabled={!autoLoaded} />
          </Section>

          {/* ───── Εφαρμογή ───── */}
          <GroupHeader title="Εφαρμογή" />

          {/* Εμφάνιση */}
          <Section title="Εμφάνιση" initiallyOpen>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <ThemedText type="smallBold">Σκούρο θέμα</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Ακολουθεί το σύστημα αν δεν το αλλάξεις χειροκίνητα.
                </ThemedText>
              </View>
              <Switch value={isDark} onValueChange={setDark} trackColor={{ true: Brand.primary }} />
            </View>
          </Section>

          {/* Επαφές κινητού — εισαγωγή + καθαρισμός */}
          <Section title="Επαφές">
            <ThemedText type="small" themeColor="textSecondary">
              Η εισαγωγή επαφών από το κινητό γίνεται από την καρτέλα «Πελάτες». Εδώ μπορείς να
              διαγράψεις όλες τις εισαγόμενες επαφές — οι επαφές της εφαρμογής (κλήσεις, έργα,
              χειροκίνητες) δεν επηρεάζονται.
            </ThemedText>
            <PrimaryButton
              label="Διαγραφή εισαγόμενων επαφών"
              tone="outline"
              onPress={confirmDeleteImported}
              busy={deletingImported}
            />
          </Section>

          {/* Δεδομένα / Ειδοποιήσεις hint */}
          <Section title="Δεδομένα & Ειδοποιήσεις">
            <ThemedText type="small" themeColor="textSecondary">
              Εξαγωγή πελατών (CSV), ομάδα και δοκιμή ειδοποιήσεων γίνονται από το web:
              www.opiflow.ai → Ρυθμίσεις.
            </ThemedText>
          </Section>

          {/* ───── Λογαριασμός ───── */}
          <GroupHeader title="Λογαριασμός" />

          {/* Λογαριασμός */}
          <Section title="Λογαριασμός">
            <Row label="Email" value={email || '—'} />
            <Row
              label="Συνδρομή"
              value={sub ? `${PLAN_LABEL[sub.plan_key] ?? sub.plan_key} · ${SUB_STATUS[sub.status] ?? sub.status}` : '—'}
            />
            {sub?.status === 'trialing' && sub.trial_ends_at ? (
              <Row label="Δοκιμή έως" value={formatDate(sub.trial_ends_at)} />
            ) : null}
            <Row label="Έκδοση εφαρμογής" value={version} />
            <View style={styles.linkRow}>
              <Pressable onPress={() => void Linking.openURL('https://www.opiflow.ai/privacy')} hitSlop={6}>
                <ThemedText type="small" style={styles.link}>Απόρρητο</ThemedText>
              </Pressable>
              <Pressable onPress={() => void Linking.openURL('https://www.opiflow.ai/terms')} hitSlop={6}>
                <ThemedText type="small" style={styles.link}>Όροι χρήσης</ThemedText>
              </Pressable>
              <Pressable onPress={() => void Linking.openURL('mailto:support@opiflow.ai')} hitSlop={6}>
                <ThemedText type="small" style={styles.link}>Υποστήριξη</ThemedText>
              </Pressable>
            </View>
          </Section>

          <Pressable onPress={signOut} style={({ pressed }) => [styles.signout, pressed && styles.pressed]}>
            <Ionicons name="log-out-outline" size={18} color="#D14343" />
            <ThemedText style={styles.signoutText}>Αποσύνδεση</ThemedText>
          </Pressable>

          {/* In-app account deletion — required by Apple 5.1.1(v) + Google Play. */}
          <Pressable
            onPress={confirmDeleteAccount}
            disabled={deleting}
            style={({ pressed }) => [styles.deleteAccount, (pressed || deleting) && styles.pressed]}>
            <Ionicons name="trash-outline" size={16} color={c.textFaint} />
            <ThemedText type="small" themeColor="textSecondary">
              {deleting ? 'Διαγραφή…' : 'Διαγραφή λογαριασμού'}
            </ThemedText>
          </Pressable>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.row}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.rowValue} numberOfLines={1}>
        {value}
      </ThemedText>
    </View>
  );
}

// Category header (B4 parity with the web settings hub).
function GroupHeader({ title }: { title: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return <ThemedText style={styles.groupHeader}>{title}</ThemedText>;
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    container: { flex: 1 },
    safe: { flex: 1 },
    kav: { flex: 1 },
    title: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, paddingBottom: Spacing.three },
    content: { paddingHorizontal: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
    groupHeader: { marginTop: Spacing.two, marginBottom: -Spacing.one, marginLeft: Spacing.one, color: c.textFaint, fontWeight: '700', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
    card: { padding: Spacing.three, borderRadius: 16 },
    profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Brand.primarySoft, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: Brand.primary, fontSize: 18, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three, paddingVertical: 6 },
    rowValue: { flexShrink: 1 },
    subhead: { marginTop: Spacing.two },
    catRow: { flexDirection: 'row', gap: Spacing.two },
    catCol: { flex: 1 },
    bankEditRow: { flexDirection: 'row', gap: Spacing.two },
    bankEditCol: { flex: 1 },
    inlineBtns: { flexDirection: 'row', gap: Spacing.two },
    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 6 },
    dayRow: { flexDirection: 'row', gap: Spacing.one, flexWrap: 'wrap' },
    dayChip: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
    dayChipOn: { backgroundColor: Brand.primary },
    dayChipText: { color: c.textSecondary, fontWeight: '700' },
    dayChipOnText: { color: '#FFFFFF', fontWeight: '700' },
    signout: {
      height: 50,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: '#E3B7B7',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    signoutText: { color: '#D14343', fontSize: 15, fontWeight: '700' },
    pressed: { opacity: 0.6 },
    linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.four, paddingTop: Spacing.two },
    link: { color: Brand.primary, fontWeight: '600' },
    deleteAccount: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: Spacing.three,
    },
  });
