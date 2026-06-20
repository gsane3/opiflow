// AI εντολές — native parity with the web /cmd assistant. Type (or dictate via
// the keyboard mic) a natural-language command; it's parsed by /api/ai/cmd into
// one of 5 intents, shown as a review, and only committed on confirm:
//   query_appointments · create_task · create_appointment · create_offer ·
//   cancel_appointment.
// Customer matching is resolved against /api/customers?q=… (pick when ambiguous).

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PrimaryButton } from '@/components/ui';
import { BottomTabInset, Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { apiGet, apiPatch, apiPost } from '@/lib/api';
import { formatEuro, todayYMD } from '@/lib/format';
import type { Business, Customer, Task } from '@/lib/types';

type CmdIntent =
  | 'query_appointments'
  | 'create_task'
  | 'create_project'
  | 'create_appointment'
  | 'create_offer'
  | 'cancel_appointment'
  | 'unknown';

interface CmdResult {
  intent: CmdIntent;
  summary: string;
  params: {
    customerName?: string;
    title?: string;
    projectTitle?: string;
    dueDate?: string;
    dueTime?: string;
    note?: string;
    priority?: 'low' | 'normal' | 'high';
    appointmentType?: 'book_appointment' | 'visit_customer';
    dateRange?: 'today' | 'tomorrow' | 'week' | 'all';
    offerItems?: Array<{ description: string; quantity: number; unitPrice: number }>;
    offerNotes?: string;
    offerTerms?: string;
  };
}

const EXAMPLES = [
  'Ποια ραντεβού έχω σήμερα;',
  'Ξεκίνα έργο για τον Παπαδόπουλο, ανακαίνιση κουζίνας',
  'Κλείσε ραντεβού με τον Καραγιάννη αύριο στις 10',
  'Στείλε προσφορά στον Αλεξάνδρου: υλικά 3500, εργατικά 500',
  'Φτιάξε task να καλέσω τον Δημητρίου αύριο',
  'Ακύρωσε το ραντεβού με τον Καραγιάννη αύριο',
];

const APPT_TYPES = new Set(['book_appointment', 'visit_customer']);

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function addDays(n: number): string {
  const d = new Date(`${todayYMD()}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Body of the AI command assistant. Rendered both as the /cmd route (fallback)
// and — primarily — inside the bottom-sheet host (see components/ai-sheet.tsx).
export function AiCommand({ onClose }: { onClose?: () => void }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [input, setInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CmdResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const [business, setBusiness] = useState<Business | null>(null);
  // Customer resolution
  const [matched, setMatched] = useState<Customer | null>(null);
  const [candidates, setCandidates] = useState<Customer[]>([]);
  const [resolved, setResolved] = useState(false);
  // Result-specific data
  const [appts, setAppts] = useState<(Task & { customerName?: string })[]>([]);
  // create_project + the «πώς να ονομάσω το έργο;» popup for appointments/offers.
  const [projectModalKind, setProjectModalKind] = useState<'appointment' | 'offer' | null>(null);
  const [projectTitleInput, setProjectTitleInput] = useState('');
  const [projectError, setProjectError] = useState('');
  const [intoProject, setIntoProject] = useState(false); // success was filed into a project (customer notified)
  const [creatingCustomer, setCreatingCustomer] = useState(false);

  useEffect(() => {
    apiGet<{ business?: Business }>('/api/businesses/me')
      .then((r) => setBusiness(r?.business ?? null))
      .catch(() => {});
  }, []);

  const vatRate = business?.default_vat_rate ?? 24;

  const reset = useCallback(() => {
    setResult(null);
    setSaved(false);
    setError('');
    setMatched(null);
    setCandidates([]);
    setResolved(false);
    setAppts([]);
    setProjectModalKind(null);
    setProjectTitleInput('');
    setProjectError('');
    setIntoProject(false);
    setCreatingCustomer(false);
  }, []);

  async function resolveCustomer(name: string | undefined): Promise<{ matched: Customer | null; candidates: Customer[] }> {
    if (!name?.trim()) return { matched: null, candidates: [] };
    try {
      const q = name.trim().replace(/^τον |^την |^το /i, '');
      const res = await apiGet<{ customers?: Customer[] }>(`/api/customers?q=${encodeURIComponent(q)}&limit=10`);
      const target = norm(q);
      const hits = (res?.customers ?? []).filter((c) => norm(c.name ?? '').includes(target));
      if (hits.length === 1) return { matched: hits[0], candidates: [] };
      if (hits.length > 1) return { matched: null, candidates: hits };
      return { matched: null, candidates: [] };
    } catch {
      return { matched: null, candidates: [] };
    }
  }

  async function loadAppts(range: string, customerId: string | null, type?: string) {
    const today = todayYMD();
    const tomorrow = addDays(1);
    const week = addDays(7);
    try {
      const [t, c] = await Promise.all([
        apiGet<{ tasks?: Task[] }>('/api/tasks?status=open&limit=200'),
        apiGet<{ customers?: Customer[] }>('/api/customers?limit=100'),
      ]);
      const names: Record<string, string> = {};
      for (const cu of c?.customers ?? []) names[cu.id] = cu.name ?? 'Πελάτης';
      const list = (t?.tasks ?? [])
        .filter((x) => APPT_TYPES.has(x.type) && x.status === 'open')
        .filter((x) => (customerId ? x.customerId === customerId : true))
        .filter((x) => (type ? x.type === type : true))
        .filter((x) => {
          if (range === 'today') return x.dueDate === today;
          if (range === 'tomorrow') return x.dueDate === tomorrow;
          if (range === 'week') return x.dueDate >= today && x.dueDate <= week;
          return true;
        })
        .map((x) => ({ ...x, customerName: x.customerId ? names[x.customerId] : undefined }));
      setAppts(list);
    } catch {
      setAppts([]);
    }
  }

  async function analyze(text: string) {
    const t = text.trim();
    if (!t) return;
    setAnalyzing(true);
    reset();
    try {
      const data = await apiPost<{ ok?: boolean; result?: CmdResult }>('/api/ai/cmd', {
        inputText: t,
        businessType: business?.type ?? undefined,
        businessName: business?.name ?? undefined,
      });
      if (!data?.ok || !data.result) {
        setError('Δεν μπόρεσα να αναλύσω την εντολή. Δοκίμασε ξανά.');
        return;
      }
      const r = data.result;
      setResult(r);

      if (r.intent === 'query_appointments') {
        await loadAppts(r.params.dateRange ?? 'today', null);
        setResolved(true);
        return;
      }
      if (r.intent === 'create_task' || r.intent === 'create_project' || r.intent === 'create_appointment' || r.intent === 'create_offer' || r.intent === 'cancel_appointment') {
        const cust = await resolveCustomer(r.params.customerName);
        setMatched(cust.matched);
        setCandidates(cust.candidates);
        const isResolved = cust.candidates.length <= 1;
        setResolved(isResolved);
        if (r.intent === 'cancel_appointment' && isResolved) {
          await loadAppts('all', cust.matched?.id ?? null, r.params.appointmentType);
        }
      }
    } catch {
      setError('Δεν μπόρεσα να αναλύσω την εντολή. Δοκίμασε ξανά.');
    } finally {
      setAnalyzing(false);
    }
  }

  function pickCandidate(c: Customer | null) {
    setMatched(c);
    setResolved(true);
    if (result?.intent === 'cancel_appointment') {
      void loadAppts('all', c?.id ?? null, result.params.appointmentType);
    }
  }

  // With workFolderId: the appointment is filed into that project and the customer
  // is auto-notified with the portal link (the project flow = actually "booked").
  // Without it: internal-only, no customer notification.
  async function saveTaskOrAppt(workFolderId?: string): Promise<boolean> {
    if (!result) return false;
    setBusy(true);
    try {
      const isAppt = result.intent === 'create_appointment';
      const r = await apiPost<{ ok?: boolean }>('/api/tasks', {
        customerId: matched?.id ?? null,
        title: result.params.title?.trim() || (isAppt ? (matched ? `Ραντεβού με ${matched.name}` : 'Νέο ραντεβού') : 'Νέο task'),
        type: isAppt ? result.params.appointmentType ?? 'book_appointment' : 'other',
        status: 'open',
        priority: result.params.priority ?? 'normal',
        dueDate: result.params.dueDate || todayYMD(),
        dueTime: result.params.dueTime || null,
        note: result.params.note || null,
        ...(workFolderId ? { workFolderId } : {}),
      });
      if (r?.ok) { setSaved(true); return true; }
      Alert.alert('Σφάλμα', 'Δεν αποθηκεύτηκε.');
      return false;
    } catch {
      Alert.alert('Σφάλμα', 'Δεν αποθηκεύτηκε.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // With workFolderId: the offer is filed into that project as `ready_to_send`,
  // which notifies the customer with the portal link (the actual "send"). Without
  // it: a `draft` + a «review & send» follow-up task (the no-project path).
  async function saveOffer(workFolderId?: string): Promise<boolean> {
    if (!result) return false;
    const items = (result.params.offerItems ?? []).filter((i) => i.description.trim() && i.quantity > 0);
    if (items.length === 0) {
      Alert.alert('Προσφορά', 'Δεν βρέθηκαν γραμμές. Γράψε περιγραφές και ποσά.');
      return false;
    }
    const filed = !!workFolderId;
    setBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean; offer?: { id: string } }>('/api/offers', {
        customerId: matched?.id ?? null,
        status: filed ? 'ready_to_send' : 'draft',
        items: items.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })),
        vatRate,
        notes: result.params.offerNotes || null,
        terms: result.params.offerTerms || business?.default_offer_terms || null,
        createdFromAi: true,
        ...(workFolderId ? { workFolderId } : {}),
      });
      if (!r?.ok || !r.offer?.id) {
        Alert.alert('Σφάλμα', 'Δεν αποθηκεύτηκε η προσφορά.');
        return false;
      }
      // No-project path only: «review & send» follow-up task (non-fatal).
      if (!filed) {
        await apiPost('/api/tasks', {
          customerId: matched?.id ?? null,
          offerId: r.offer.id,
          title: 'Έλεγχος και αποστολή προσφοράς',
          type: 'send_offer',
          status: 'open',
          dueDate: todayYMD(),
          note: 'Δημιουργήθηκε από AI εντολή. Έλεγξε την προσφορά πριν τη στείλεις.',
        }).catch(() => {});
      }
      setSaved(true);
      return true;
    } catch {
      Alert.alert('Σφάλμα', 'Δεν αποθηκεύτηκε η προσφορά.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ---- Έργο (work folder) helpers + the «πώς να ονομάσω το έργο;» popup ----

  function suggestProjectTitle(): string {
    const fromAi = result?.params.projectTitle?.trim();
    if (fromAi) return fromAi;
    const fromTitle = result?.params.title?.trim();
    if (fromTitle) return fromTitle;
    return matched ? `Έργο — ${matched.name}` : 'Νέο έργο';
  }

  async function createFolder(customerId: string, title: string): Promise<string | null> {
    try {
      const r = await apiPost<{ ok?: boolean; folder?: { id: string } }>(`/api/customers/${customerId}/folders`, {
        title: title.trim() || 'Νέο έργο',
      });
      return r?.ok && r.folder?.id ? r.folder.id : null;
    } catch {
      return null;
    }
  }

  async function saveProject() {
    if (!result || !matched) return;
    setBusy(true);
    setProjectError('');
    const folderId = await createFolder(matched.id, projectTitleInput || suggestProjectTitle());
    setBusy(false);
    if (folderId) setSaved(true);
    else Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε το έργο.');
  }

  function openProjectModal(kind: 'appointment' | 'offer') {
    setProjectError('');
    setProjectTitleInput(suggestProjectTitle());
    setProjectModalKind(kind);
  }

  async function confirmProjectModal() {
    if (!result || !matched || !projectModalKind) return;
    const kind = projectModalKind;
    setBusy(true);
    setProjectError('');
    const folderId = await createFolder(matched.id, projectTitleInput || suggestProjectTitle());
    if (!folderId) {
      setBusy(false);
      setProjectError('Δεν δημιουργήθηκε το έργο. Δοκίμασε ξανά.');
      return;
    }
    const ok = kind === 'appointment' ? await saveTaskOrAppt(folderId) : await saveOffer(folderId);
    if (ok) {
      setIntoProject(true);
      setProjectModalKind(null);
    } else {
      setProjectError('Το έργο δημιουργήθηκε, αλλά η ενέργεια απέτυχε.');
    }
  }

  async function createCustomer() {
    const name = result?.params.customerName?.trim();
    if (!name) return;
    setCreatingCustomer(true);
    try {
      const r = await apiPost<{ ok?: boolean; customer?: Customer }>('/api/customers', { name });
      if (r?.ok && r.customer) {
        setMatched(r.customer);
        setCandidates([]);
        setResolved(true);
      } else {
        Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε ο πελάτης.');
      }
    } catch {
      Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε ο πελάτης.');
    } finally {
      setCreatingCustomer(false);
    }
  }

  function cancelAppt(appt: Task & { customerName?: string }) {
    Alert.alert('Ακύρωση ραντεβού', `${appt.title}${appt.dueTime ? ` · ${appt.dueTime}` : ''}`, [
      { text: 'Πίσω', style: 'cancel' },
      {
        text: 'Ναι, ακύρωση',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const r = await apiPatch<{ ok?: boolean }>(`/api/tasks/${appt.id}`, { status: 'cancelled' });
            if (r?.ok) {
              setAppts((p) => p.filter((x) => x.id !== appt.id));
              setSaved(true);
            } else Alert.alert('Σφάλμα', 'Δεν ακυρώθηκε.');
          } catch {
            Alert.alert('Σφάλμα', 'Δεν ακυρώθηκε.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  const offerTotals = (() => {
    if (result?.intent !== 'create_offer') return null;
    const items = (result.params.offerItems ?? []).filter((i) => i.description.trim() && i.quantity > 0);
    const sub = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const vat = Number(((sub * vatRate) / 100).toFixed(2));
    return { items, sub, vat, total: Number((sub + vat).toFixed(2)) };
  })();

  return (
    <ThemedView style={styles.fill}>
      <SafeAreaView edges={onClose ? [] : ['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Ionicons name="sparkles" size={22} color={Brand.primary} />
          <View style={{ flex: 1 }}>
            <ThemedText type="subtitle" style={styles.title}>AI εντολές</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">Γράψε ή υπαγόρευσε — βλέπεις έλεγχο πριν αποθηκευτεί.</ThemedText>
          </View>
          <Pressable onPress={() => (onClose ? onClose() : router.back())} hitSlop={10} style={styles.back}>
            <Ionicons name="close" size={26} color={c.textSecondary} />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Input */}
        <View style={styles.inputCard}>
          <View style={styles.inputRow}>
            <TextInput
              ref={inputRef}
              value={input}
              onChangeText={setInput}
              placeholder="Π.χ. Κλείσε ραντεβού με τον Καραγιάννη αύριο στις 10"
              placeholderTextColor={c.textFaint}
              multiline
              style={[styles.input, styles.inputFlex]}
            />
            {/* Dictation: focus the field so the keyboard mic appears. */}
            <Pressable
              accessibilityLabel="Υπαγόρευση"
              onPress={() => inputRef.current?.focus()}
              style={({ pressed }) => [styles.micBtn, pressed && { opacity: 0.85 }]}
            >
              <Ionicons name="mic" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
          <PrimaryButton
            label={analyzing ? 'Ανάλυση…' : 'Ανάλυση εντολής'}
            busy={analyzing}
            disabled={!input.trim()}
            onPress={() => void analyze(input)}
          />
          {!result && !analyzing ? (
            <View style={styles.examples}>
              {EXAMPLES.map((ex) => (
                <Pressable key={ex} onPress={() => setInput(ex)} style={({ pressed }) => [styles.exChip, pressed && styles.pressed]}>
                  <ThemedText type="small" style={styles.exText}>{ex}</ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}
          {error ? <ThemedText type="small" style={styles.err}>{error}</ThemedText> : null}
        </View>

        {/* Result */}
        {result && !analyzing ? (
          <View style={styles.resultWrap}>
            <View style={styles.summaryBox}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Ανάλυση</ThemedText>
              <ThemedText type="small" style={styles.summaryText}>{result.summary}</ThemedText>
            </View>

            {/* Candidate picker (ambiguous customer) */}
            {candidates.length > 1 && !resolved ? (
              <View style={styles.card}>
                <ThemedText type="smallBold" style={styles.dark}>Βρέθηκαν πολλοί πελάτες — διάλεξε:</ThemedText>
                {candidates.map((c) => (
                  <Pressable key={c.id} onPress={() => pickCandidate(c)} style={({ pressed }) => [styles.candidate, pressed && styles.pressed]}>
                    <ThemedText type="smallBold" style={styles.dark}>{c.name}</ThemedText>
                    {(c.mobilePhone || c.phone) ? <ThemedText type="small" themeColor="textSecondary">{c.mobilePhone || c.phone}</ThemedText> : null}
                  </Pressable>
                ))}
                <Pressable onPress={() => pickCandidate(null)} style={({ pressed }) => [pressed && styles.pressed]}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.withoutLink}>Συνέχεια χωρίς σύνδεση πελάτη</ThemedText>
                </Pressable>
              </View>
            ) : null}

            {resolved && saved ? (
              <View style={styles.okBox}>
                <Ionicons name="checkmark-circle" size={20} color="#1B8A4C" />
                <ThemedText type="smallBold" style={styles.okText}>
                  {intoProject ? 'Έγινε — μπήκε στο έργο και ειδοποιήθηκε ο πελάτης.' : 'Έγινε.'}
                </ThemedText>
              </View>
            ) : null}

            {/* unknown */}
            {result.intent === 'unknown' ? (
              <View style={styles.warnBox}>
                <ThemedText type="small" style={styles.warnText}>Αυτή η εντολή δεν υποστηρίζεται ακόμα ή χρειάζεται ξεχωριστή επιβεβαίωση.</ThemedText>
              </View>
            ) : null}

            {/* query_appointments */}
            {result.intent === 'query_appointments' ? (
              <View style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Ραντεβού</ThemedText>
                {appts.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">Δεν βρέθηκαν ραντεβού για αυτό το διάστημα.</ThemedText>
                ) : (
                  appts.map((a) => (
                    <Pressable key={a.id} onPress={() => a.customerId && router.push({ pathname: '/customers/[id]', params: { id: a.customerId } })} style={({ pressed }) => [styles.apptRow, pressed && styles.pressed]}>
                      <ThemedText type="smallBold" style={styles.dark} numberOfLines={1}>{a.title}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {a.dueDate.split('-').reverse().join('-')}{a.dueTime ? ` ${a.dueTime}` : ''}{a.customerName ? ` · ${a.customerName}` : ''}
                      </ThemedText>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}

            {/* create_project */}
            {result.intent === 'create_project' && resolved && !saved ? (
              <View style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Νέο έργο (προεπισκόπηση)</ThemedText>
                {matched ? (
                  <>
                    <Row k="Πελάτης" v={matched.name ?? ''} />
                    <ThemedText type="small" themeColor="textSecondary">Όνομα έργου</ThemedText>
                    <TextInput
                      value={projectTitleInput || suggestProjectTitle()}
                      onChangeText={setProjectTitleInput}
                      placeholder="Π.χ. Ανακαίνιση κουζίνας"
                      placeholderTextColor={c.textFaint}
                      style={styles.projectInput}
                    />
                    <PrimaryButton label="Δημιουργία έργου" busy={busy} onPress={() => void saveProject()} />
                  </>
                ) : (
                  <>
                    <ThemedText type="small" style={styles.warnText}>
                      {result.params.customerName
                        ? `Δεν βρέθηκε πελάτης «${result.params.customerName}». Το έργο χρειάζεται πελάτη.`
                        : 'Πες σε ποιον πελάτη ανήκει το έργο (π.χ. «ξεκίνα έργο για τον Νίκο»).'}
                    </ThemedText>
                    {result.params.customerName ? (
                      <PrimaryButton label={`Δημιουργία πελάτη «${result.params.customerName}»`} tone="outline" busy={creatingCustomer} onPress={() => void createCustomer()} />
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            {/* create_task / create_appointment */}
            {(result.intent === 'create_task' || result.intent === 'create_appointment') && resolved && !saved ? (
              <View style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                  {result.intent === 'create_appointment' ? 'Νέο ραντεβού (προεπισκόπηση)' : 'Νέο task (προεπισκόπηση)'}
                </ThemedText>
                <Row k="Τίτλος" v={result.params.title?.trim() || (result.intent === 'create_appointment' ? (matched ? `Ραντεβού με ${matched.name}` : 'Νέο ραντεβού') : 'Νέο task')} />
                {matched ? <Row k="Πελάτης" v={matched.name ?? ''} /> : <Row k="Πελάτης" v="— (χωρίς σύνδεση)" />}
                <Row k="Ημερομηνία" v={result.params.dueDate ? `${result.params.dueDate}${result.params.dueTime ? ` ${result.params.dueTime}` : ''}` : 'Σήμερα'} />
                {result.params.note ? <Row k="Σημείωση" v={result.params.note} /> : null}
                {!matched && result.params.customerName ? (
                  <PrimaryButton label={`Δημιουργία πελάτη «${result.params.customerName}»`} tone="outline" busy={creatingCustomer} onPress={() => void createCustomer()} />
                ) : null}
                {result.intent === 'create_appointment' && matched ? (
                  <>
                    <PrimaryButton label="Δημιουργία ραντεβού" busy={busy} onPress={() => openProjectModal('appointment')} />
                    <Pressable disabled={busy} onPress={() => void saveTaskOrAppt()} style={({ pressed }) => [pressed && styles.pressed]}>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.secondaryLink}>Ραντεβού χωρίς έργο (εσωτερικό)</ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <PrimaryButton label="Αποθήκευση" busy={busy} onPress={() => void saveTaskOrAppt()} />
                )}
              </View>
            ) : null}

            {/* create_offer */}
            {result.intent === 'create_offer' && resolved && !saved && offerTotals ? (
              <View style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Πρόχειρη προσφορά (προεπισκόπηση)</ThemedText>
                {matched ? <Row k="Πελάτης" v={matched.name ?? ''} /> : <Row k="Πελάτης" v="— (χωρίς σύνδεση)" />}
                {offerTotals.items.length === 0 ? (
                  <ThemedText type="small" style={styles.warnText}>Δεν βρέθηκαν γραμμές προσφοράς στην εντολή.</ThemedText>
                ) : (
                  <>
                    {offerTotals.items.map((it, i) => (
                      <View key={i} style={styles.offerLine}>
                        <ThemedText type="small" style={[styles.dark, { flex: 1 }]} numberOfLines={1}>{it.description}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">{it.quantity}× {formatEuro(it.unitPrice)}</ThemedText>
                      </View>
                    ))}
                    <View style={styles.totalsBox}>
                      <Row k="Καθαρή αξία" v={formatEuro(offerTotals.sub)} />
                      <Row k={`ΦΠΑ ${vatRate}%`} v={formatEuro(offerTotals.vat)} />
                      <Row k="Σύνολο" v={formatEuro(offerTotals.total)} bold />
                    </View>
                    {!matched && result.params.customerName ? (
                      <PrimaryButton label={`Δημιουργία πελάτη «${result.params.customerName}»`} tone="outline" busy={creatingCustomer} onPress={() => void createCustomer()} />
                    ) : null}
                    {matched ? (
                      <>
                        <PrimaryButton label="Στείλε προσφορά" busy={busy} onPress={() => openProjectModal('offer')} />
                        <Pressable disabled={busy} onPress={() => void saveOffer()} style={({ pressed }) => [pressed && styles.pressed]}>
                          <ThemedText type="small" themeColor="textSecondary" style={styles.secondaryLink}>Μόνο πρόχειρο (χωρίς αποστολή)</ThemedText>
                        </Pressable>
                      </>
                    ) : (
                      <>
                        <ThemedText type="small" themeColor="textSecondary">Θα δημιουργηθεί πρόχειρο. Δεν στέλνεται στον πελάτη.</ThemedText>
                        <PrimaryButton label="Δημιουργία πρόχειρης προσφοράς" busy={busy} onPress={() => void saveOffer()} />
                      </>
                    )}
                  </>
                )}
              </View>
            ) : null}

            {/* cancel_appointment */}
            {result.intent === 'cancel_appointment' && resolved && !saved ? (
              <View style={styles.card}>
                <ThemedText type="small" themeColor="textSecondary" style={styles.label}>Ακύρωση ραντεβού</ThemedText>
                {appts.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">Δεν βρέθηκαν ανοιχτά ραντεβού με αυτά τα κριτήρια.</ThemedText>
                ) : (
                  appts.map((a) => (
                    <View key={a.id} style={styles.apptRow}>
                      <ThemedText type="smallBold" style={styles.dark} numberOfLines={1}>{a.title}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {a.dueDate.split('-').reverse().join('-')}{a.dueTime ? ` ${a.dueTime}` : ''}{a.customerName ? ` · ${a.customerName}` : ''}
                      </ThemedText>
                      <Pressable disabled={busy} onPress={() => cancelAppt(a)} style={({ pressed }) => [pressed && styles.pressed]}>
                        <ThemedText type="small" style={styles.cancelLink}>Ακύρωση ραντεβού</ThemedText>
                      </Pressable>
                    </View>
                  ))
                )}
                <ThemedText type="small" themeColor="textSecondary">Δεν στέλνεται ενημέρωση στον πελάτη από αυτή την εντολή.</ThemedText>
              </View>
            ) : null}

            <PrimaryButton label="Νέα εντολή" tone="outline" onPress={() => { setInput(''); reset(); }} />
          </View>
        ) : null}

        {analyzing ? <ActivityIndicator color={Brand.primary} style={{ marginTop: Spacing.four }} /> : null}
      </ScrollView>

      {/* «Πώς να ονομάσω το έργο;» — project-name popup for appointments/offers. */}
      <Modal visible={!!projectModalKind && !!matched} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setProjectModalKind(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setProjectModalKind(null)} />
          <View style={[styles.modalCard, { backgroundColor: c.card }]}>
            <ThemedText type="subtitle" style={styles.dark}>Πώς να ονομάσω το έργο;</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {projectModalKind === 'offer'
                ? `Θα δημιουργηθεί το έργο για ${matched?.name ?? 'τον πελάτη'} και θα σταλεί η προσφορά με τον σύνδεσμο.`
                : `Θα δημιουργηθεί το έργο για ${matched?.name ?? 'τον πελάτη'} και θα κλειστεί το ραντεβού. Ο πελάτης θα ειδοποιηθεί.`}
            </ThemedText>
            <TextInput
              autoFocus
              value={projectTitleInput}
              onChangeText={setProjectTitleInput}
              placeholder="Π.χ. Ανακαίνιση κουζίνας"
              placeholderTextColor={c.textFaint}
              style={styles.projectInput}
            />
            {projectError ? <ThemedText type="small" style={styles.err}>{projectError}</ThemedText> : null}
            <View style={styles.modalBtns}>
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Πίσω" tone="outline" onPress={() => { setProjectModalKind(null); setProjectError(''); }} />
              </View>
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={projectModalKind === 'offer' ? 'Δημιουργία & αποστολή' : 'Δημιουργία & κλείσιμο'}
                  busy={busy}
                  disabled={!projectTitleInput.trim()}
                  onPress={() => void confirmProjectModal()}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

// /cmd route fallback (the FAB now opens AiCommand as a bottom sheet instead).
export default function CmdScreen() {
  return <AiCommand />;
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">{k}</ThemedText>
      <ThemedText type={bold ? 'smallBold' : 'small'} style={[styles.dark, { flexShrink: 1, textAlign: 'right' }]}>{v}</ThemedText>
    </View>
  );
}

const makeStyles = (c: ThemePalette) => StyleSheet.create({
  fill: { flex: 1 },
  headerSafe: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  back: { padding: 4 },
  title: { fontSize: 20 },
  body: { padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.six, gap: Spacing.three },
  inputCard: { backgroundColor: c.card, borderRadius: 20, padding: Spacing.three, gap: Spacing.three, borderWidth: 1, borderColor: c.border },
  input: { minHeight: 60, fontSize: 16, color: c.text, textAlignVertical: 'top' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  inputFlex: { flex: 1 },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Brand.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Brand.primary,
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  examples: { gap: Spacing.one },
  exChip: { backgroundColor: c.surface, borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 8 },
  exText: { color: c.textSecondary },
  err: { color: '#D14343' },
  resultWrap: { gap: Spacing.three },
  summaryBox: { backgroundColor: c.surface, borderRadius: 14, padding: Spacing.three, gap: 2 },
  label: { textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11 },
  summaryText: { color: c.textSecondary },
  card: { backgroundColor: c.card, borderRadius: 18, padding: Spacing.three, gap: Spacing.two, borderWidth: 1, borderColor: c.border },
  dark: { color: c.text },
  candidate: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three },
  withoutLink: { paddingTop: Spacing.one },
  okBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: '#EAF7EF', borderRadius: 12, padding: Spacing.three },
  okText: { color: '#1B8A4C' },
  warnBox: { backgroundColor: '#FFF7E6', borderRadius: 12, padding: Spacing.three },
  warnText: { color: '#9A6B00' },
  apptRow: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.three },
  offerLine: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  totalsBox: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three, gap: 4 },
  cancelLink: { color: '#D14343', fontWeight: '700', paddingTop: 4 },
  secondaryLink: { textAlign: 'center', paddingTop: Spacing.two, textDecorationLine: 'underline' },
  projectInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    fontSize: 16,
    color: c.text,
    marginTop: Spacing.one,
  },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,17,32,0.45)', padding: Spacing.four },
  modalCard: { width: '100%', maxWidth: 380, borderRadius: 24, padding: Spacing.four, gap: Spacing.two },
  modalBtns: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  pressed: { opacity: 0.6 },
});
