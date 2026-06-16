// «Έργα» — per-job grouping under a customer (WF-1B + WF-4, native).
// Self-contained: lists the customer's folders, creates one, opens detail/edit sheet
// with real sections (WF-4): Προσφορές / Ραντεβού / Μηνύματα / Φωτογραφίες /
// Στοιχεία πελάτη, plus: attach existing, detach, quick-create filed into folder.

import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChipSelect, Input, PrimaryButton, SheetModal } from '@/components/ui';
import { Brand, Spacing, type ThemePalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, apiGet, apiPatch, apiPost } from '@/lib/api';
import { dmyToYmd, formatDate, todayYMD } from '@/lib/format';
import type { WorkFolder, WorkFolderCounts } from '@/lib/types';

// ---------------------------------------------------------------------------
// WF-4 inline types (folder detail API shapes)
// ---------------------------------------------------------------------------

interface DetailOffer {
  id: string;
  offerNumber: string | null;
  status: string;
  total: number | null;
  createdAt: string;
}
interface DetailAppt {
  id: string;
  title: string;
  type: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
}
interface DetailMsg {
  id: string;
  summary: string | null;
  direction: string;
  channel: string;
  createdAt: string;
}
interface DetailUpload {
  id: string;
  status: string;
  sentChannel: string | null;
  createdAt: string;
  openedAt: string | null;
  completedAt: string | null;
}
interface DetailIntake {
  id: string;
  status: string;
  sentChannel: string | null;
  createdAt: string;
  openedAt: string | null;
  submittedAt: string | null;
}
interface FolderDetail {
  folder: { id: string; title: string; status: string };
  customer: { id: string; name: string | null; phone: string | null; email: string | null } | null;
  sections: {
    offers: { count: number; items: DetailOffer[] };
    appointments: { count: number; items: DetailAppt[] };
    messages: { count: number; items: DetailMsg[] };
    photos: { count: number; items: DetailUpload[] };
    intake: { count: number; items: DetailIntake[] };
  };
}
interface AttachOffer {
  id: string;
  offerNumber: string | null;
  status: string;
  total: number | null;
}
interface AttachAppt {
  id: string;
  title: string;
  type: string;
  status: string;
  dueDate: string | null;
}
interface AttachMsg {
  id: string;
  direction: string;
  channel: string;
  summary: string | null;
  createdAt: string;
}
interface AttachReq {
  id: string;
  status: string;
  sentChannel: string | null;
  createdAt: string;
}
interface BizPayment {
  id: string;
  kind: string;
  pct: number | null;
  amount: number;
  currency: string;
  status: string;
  receivingAccount: string | null;
  declaredAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Greek label maps
// ---------------------------------------------------------------------------

const OFFER_STATUS_GR: Record<string, string> = {
  draft: 'Πρόχειρη',
  ready_to_send: 'Έτοιμη',
  sent_manually: 'Στάλθηκε',
  sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
  cancelled: 'Ακυρώθηκε',
};
const APPT_TYPE_GR: Record<string, string> = {
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη',
};
const PAYMENT_KIND_GR: Record<string, string> = { deposit: 'Προκαταβολή', balance: 'Εξόφληση' };
const PAYMENT_STATUS_GR: Record<string, string> = {
  pending: 'Εκκρεμεί',
  declared: 'Δηλώθηκε κατάθεση',
  confirmed: 'Επιβεβαιώθηκε',
  cancelled: 'Ακυρώθηκε',
};
const PAYMENT_KIND_OPTIONS = [
  { key: 'deposit', label: 'Προκαταβολή' },
  { key: 'balance', label: 'Εξόφληση' },
];

// ---------------------------------------------------------------------------
// Process tracker (Διαδικασία) — 5 steps, index = work_folders.step (0..4).
// Mirrors WORK_FOLDER_STEPS on the server + the web Stepper.
// ---------------------------------------------------------------------------

const ERGO_STEPS = ['Επαφή', 'Προσφορά', 'Πληρωμή', 'Ραντεβού', 'Τέλος'] as const;

function clampStep(n: number | undefined): number {
  const i = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : 0;
  return i < 0 ? 0 : i > ERGO_STEPS.length - 1 ? ERGO_STEPS.length - 1 : i;
}

function ergoStepCaption(step: number | undefined): string {
  const cur = clampStep(step);
  return `Βήμα ${cur + 1}/${ERGO_STEPS.length} · ${ERGO_STEPS[cur]}`;
}

function WorkFolderStepper({ step, c }: { step: number | undefined; c: ThemePalette }) {
  const cur = clampStep(step);
  return (
    <View style={{ flexDirection: 'row', gap: 4, marginVertical: Spacing.two }}>
      {ERGO_STEPS.map((label, i) => {
        const on = i <= cur;
        const now = i === cur;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center', gap: 3 }}>
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? Brand.primary : c.surface,
                borderWidth: now ? 2 : 0,
                borderColor: Brand.primarySoft,
              }}>
              <ThemedText style={{ fontSize: 11, fontWeight: '700', color: on ? Brand.onPrimary : c.textFaint }}>
                {i < cur ? '✓' : String(i + 1)}
              </ThemedText>
            </View>
            <ThemedText
              numberOfLines={1}
              style={{ fontSize: 9, textAlign: 'center', color: now ? c.text : c.textFaint, fontWeight: now ? '700' : '400' }}>
              {label}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}
const APPT_TYPE_OPTIONS = [
  { key: 'book_appointment', label: 'Ραντεβού' },
  { key: 'visit_customer', label: 'Επίσκεψη' },
];
const REQ_STATUS_GR: Record<string, string> = {
  pending: 'Εκκρεμεί',
  sent: 'Στάλθηκε',
  opened: 'Ανοίχτηκε',
  submitted: 'Υποβλήθηκε',
  completed: 'Ολοκληρώθηκε',
  expired: 'Έληξε',
  revoked: 'Ακυρώθηκε',
};

function money(n: number | null): string {
  return typeof n === 'number' ? `€${n.toLocaleString('el-GR')}` : '';
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Νέο',
  in_progress: 'Σε εξέλιξη',
  done: 'Ολοκληρώθηκε',
  archived: 'Αρχειοθετήθηκε',
};

const STATUS_OPTIONS = [
  { key: 'open', label: 'Νέο' },
  { key: 'in_progress', label: 'Σε εξέλιξη' },
  { key: 'done', label: 'Ολοκληρώθηκε' },
  { key: 'archived', label: 'Αρχειοθετήθηκε' },
];

/** Short «2 προσφορές · 1 ραντεβού» summary from the API counts (non-zero only). */
function countsSummary(counts?: WorkFolderCounts): string {
  if (!counts) return '';
  const parts: string[] = [];
  if (counts.offers) parts.push(`${counts.offers} προσφορές`);
  if (counts.appointments) parts.push(`${counts.appointments} ραντεβού`);
  if (counts.messages) parts.push(`${counts.messages} μηνύματα`);
  if (counts.uploadRequests) parts.push(`${counts.uploadRequests} φωτογραφίες`);
  return parts.join(' · ');
}

export function WorkFoldersSection({ customerId }: { customerId: string }) {
  const c = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  const [folders, setFolders] = useState<WorkFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // create sheet
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('open');
  const [titleError, setTitleError] = useState('');
  const [saving, setSaving] = useState(false);

  // detail/edit sheet
  const [detail, setDetail] = useState<WorkFolder | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [eTitle, setETitle] = useState('');
  const [eNotes, setENotes] = useState('');
  const [eStatus, setEStatus] = useState('open');
  const [eBusy, setEBusy] = useState(false);

  // public folder link (WF-2)
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  // WF-4: folder detail sections
  const [fdetail, setFdetail] = useState<FolderDetail | null>(null);
  const [fdLoading, setFdLoading] = useState(false);
  const [fdError, setFdError] = useState(false);

  // WF-4: attach existing sheet
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachError, setAttachError] = useState(false);
  const [attOffers, setAttOffers] = useState<AttachOffer[]>([]);
  const [attAppts, setAttAppts] = useState<AttachAppt[]>([]);
  const [attMsgs, setAttMsgs] = useState<AttachMsg[]>([]);
  const [attIntake, setAttIntake] = useState<AttachReq[]>([]);
  const [attUpload, setAttUpload] = useState<AttachReq[]>([]);

  // WF-4: quick-create offer sheet
  const [newOfferOpen, setNewOfferOpen] = useState(false);
  const [qoDesc, setQoDesc] = useState('');
  const [qoAmount, setQoAmount] = useState('');
  const [qoError, setQoError] = useState('');
  const [qoBusy, setQoBusy] = useState(false);

  // WF-4: quick-create appointment sheet
  const [newApptOpen, setNewApptOpen] = useState(false);
  const [qaTitle, setQaTitle] = useState('');
  const [qaType, setQaType] = useState('book_appointment');
  const [qaDate, setQaDate] = useState(todayYMD());
  const [qaError, setQaError] = useState('');
  const [qaBusy, setQaBusy] = useState(false);

  // WF-4: tracks which detach/attach button is in-flight (entityType:id);
  // also keys payment confirm/cancel as `pay:<id>:<status>`.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Stage 8f: payments (create request + owner confirm/cancel)
  const [payments, setPayments] = useState<BizPayment[]>([]);
  const [newPaymentOpen, setNewPaymentOpen] = useState(false);
  const [ppOfferId, setPpOfferId] = useState<string | null>(null);
  const [ppKind, setPpKind] = useState('deposit');
  const [ppPct, setPpPct] = useState('30');
  const [ppError, setPpError] = useState('');
  const [ppBusy, setPpBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ ok?: boolean; folders?: WorkFolder[] }>(`/api/customers/${customerId}/folders`);
      setFolders(r?.folders ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  // WF-4: fetch folder detail sections
  const loadFolderDetail = useCallback(async (folderId: string) => {
    setFdLoading(true);
    setFdError(false);
    try {
      const r = await apiGet<{ ok?: boolean } & Partial<FolderDetail>>(`/api/folders/${folderId}`);
      if (r?.ok && r.sections) {
        setFdetail(r as FolderDetail);
      } else {
        setFdError(true);
      }
    } catch {
      setFdError(true);
    } finally {
      setFdLoading(false);
    }
  }, []);

  // Stage 8f: fetch the folder's payment requests (owner list)
  const loadFolderPayments = useCallback(async (folderId: string) => {
    try {
      const r = await apiGet<{ ok?: boolean; payments?: BizPayment[] }>(`/api/folders/${folderId}/payment-requests`);
      if (r?.ok) setPayments(r.payments ?? []);
    } catch {
      // keep prior payments on transient error
    }
  }, []);

  // WF-4: open attach-existing sheet for the given folder
  const openAttachSheet = useCallback(async (folderId: string) => {
    setAttachOpen(true);
    setAttachLoading(true);
    setAttachError(false);
    setAttOffers([]);
    setAttAppts([]);
    setAttMsgs([]);
    setAttIntake([]);
    setAttUpload([]);
    try {
      const r = await apiGet<{
        ok?: boolean;
        offers?: AttachOffer[];
        appointments?: AttachAppt[];
        messages?: AttachMsg[];
        intake?: AttachReq[];
        upload?: AttachReq[];
      }>(`/api/folders/${folderId}/attachable`);
      if (r?.ok) {
        setAttOffers(r.offers ?? []);
        setAttAppts(r.appointments ?? []);
        setAttMsgs(r.messages ?? []);
        setAttIntake(r.intake ?? []);
        setAttUpload(r.upload ?? []);
      } else {
        setAttachError(true);
      }
    } catch {
      setAttachError(true);
    } finally {
      setAttachLoading(false);
    }
  }, []);

  // WF-4: attach or detach an entity from a folder
  async function setFolderLink(
    folderId: string,
    entityType: 'offer' | 'task' | 'communication' | 'intake_token' | 'upload_token',
    entityId: string,
    attach: boolean,
  ) {
    const key = `${entityType}:${entityId}`;
    setBusyKey(key);
    try {
      const r = await apiPost<{ ok?: boolean }>(`/api/folders/${folderId}/attach`, { entityType, entityId, attach });
      if (r?.ok) {
        Alert.alert('', attach ? 'Συνδέθηκε με το έργο' : 'Αφαιρέθηκε από το έργο');
        if (attach && attachOpen) {
          // drop the just-attached item from the pick lists
          setAttOffers((p) => p.filter((o) => o.id !== entityId));
          setAttAppts((p) => p.filter((a) => a.id !== entityId));
          setAttMsgs((p) => p.filter((m) => m.id !== entityId));
          setAttIntake((p) => p.filter((i) => i.id !== entityId));
          setAttUpload((p) => p.filter((u) => u.id !== entityId));
        }
        void loadFolderDetail(folderId);
        void load();
      } else {
        Alert.alert('Σφάλμα', attach ? 'Δεν έγινε η σύνδεση. Δοκίμασε ξανά.' : 'Δεν αφαιρέθηκε. Δοκίμασε ξανά.');
      }
    } catch (e) {
      const isNet = e instanceof ApiError && e.isNetwork;
      Alert.alert('Σφάλμα', isNet ? 'Έλεγξε τη σύνδεση.' : attach ? 'Δεν έγινε η σύνδεση. Δοκίμασε ξανά.' : 'Δεν αφαιρέθηκε. Δοκίμασε ξανά.');
    } finally {
      setBusyKey(null);
    }
  }

  // WF-4B: one-tap request — create + send a photo/intake request filed into the folder
  async function sendFolderRequest(folderId: string, customerId: string, kind: 'upload' | 'intake') {
    const key = `req:${kind}`;
    setBusyKey(key);
    try {
      const path = kind === 'upload' ? 'upload-link' : 'intake-link';
      const r = await apiPost<{ ok?: boolean; sent?: boolean; fallbackReason?: string }>(
        `/api/customers/${customerId}/${path}`,
        { mode: 'send', workFolderId: folderId },
      );
      if (r?.ok) {
        if (r.sent) {
          Alert.alert('', kind === 'upload' ? 'Στάλθηκε το αίτημα φωτογραφιών.' : 'Στάλθηκε το αίτημα στοιχείων.');
        } else if (r.fallbackReason === 'missing_mobile') {
          Alert.alert('', 'Λείπει κινητό τηλέφωνο.');
        } else {
          Alert.alert('', 'Δεν στάλθηκε. Δοκίμασε ξανά.');
        }
        // Token is always created + filed, so always refresh
        void loadFolderDetail(folderId);
        void load();
      } else {
        Alert.alert('Σφάλμα', 'Δεν στάλθηκε. Δοκίμασε ξανά.');
      }
    } catch (e) {
      const isNet = e instanceof ApiError && e.isNetwork;
      Alert.alert('Σφάλμα', isNet ? 'Έλεγξε τη σύνδεση.' : 'Δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally {
      setBusyKey(null);
    }
  }

  // WF-4: quick-create offer filed into folder
  async function submitNewOffer(folderId: string) {
    const desc = qoDesc.trim();
    const amount = Number(qoAmount.replace(',', '.'));
    if (!desc) { setQoError('Γράψε περιγραφή.'); return; }
    if (!isFinite(amount) || amount < 0) { setQoError('Γράψε ποσό.'); return; }
    const customerId2 = fdetail?.customer?.id;
    if (!customerId2) { setQoError('Δεν βρέθηκε ο πελάτης.'); return; }
    setQoBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean }>('/api/offers', {
        customerId: customerId2,
        workFolderId: folderId,
        items: [{ description: desc, quantity: 1, unitPrice: amount }],
      });
      if (r?.ok) {
        setNewOfferOpen(false);
        Alert.alert('', 'Συνδέθηκε με το έργο');
        void loadFolderDetail(folderId);
        void load();
      } else {
        setQoError('Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
      }
    } catch (e) {
      setQoError(e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } finally {
      setQoBusy(false);
    }
  }

  // WF-4: quick-create appointment filed into folder
  async function submitNewAppt(folderId: string) {
    const titleVal = qaTitle.trim();
    if (!titleVal) { setQaError('Γράψε τίτλο.'); return; }
    const customerId2 = fdetail?.customer?.id;
    if (!customerId2) { setQaError('Δεν βρέθηκε ο πελάτης.'); return; }
    // Accept the field in either YYYY-MM-DD (default) or the app's DD-MM-YYYY
    // display convention; the API only accepts YYYY-MM-DD.
    const raw = qaDate.trim() || todayYMD();
    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : dmyToYmd(raw);
    if (!ymd) { setQaError('Γράψε ημερομηνία ΕΕΕΕ-ΜΜ-ΗΗ.'); return; }
    setQaBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean }>('/api/tasks', {
        customerId: customerId2,
        workFolderId: folderId,
        title: titleVal,
        type: qaType,
        dueDate: ymd,
      });
      if (r?.ok) {
        setNewApptOpen(false);
        Alert.alert('', 'Συνδέθηκε με το έργο');
        void loadFolderDetail(folderId);
        void load();
      } else {
        setQaError('Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
      }
    } catch (e) {
      setQaError(e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } finally {
      setQaBusy(false);
    }
  }

  // Stage 8f: open the create-payment sheet, defaulting to the accepted offer.
  function openNewPayment() {
    const offers = fdetail?.sections.offers.items ?? [];
    const accepted = offers.find((o) => o.status === 'accepted');
    setPpOfferId((accepted ?? offers[0])?.id ?? null);
    setPpKind('deposit');
    setPpPct('30');
    setPpError('');
    setNewPaymentOpen(true);
  }

  // Stage 8f: create a deposit/balance payment request (amount computed server-side).
  async function submitNewPayment(folderId: string) {
    if (!ppOfferId) { setPpError('Διάλεξε προσφορά.'); return; }
    const pct = Number(ppPct.replace(',', '.'));
    if (!isFinite(pct) || pct <= 0 || pct > 100) { setPpError('Δώσε ποσοστό 1–100.'); return; }
    setPpBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean; error?: string }>(`/api/folders/${folderId}/payment-request`, {
        kind: ppKind,
        pct,
        offerId: ppOfferId,
      });
      if (r?.ok) {
        setNewPaymentOpen(false);
        Alert.alert('', 'Δημιουργήθηκε αίτημα πληρωμής');
        void loadFolderPayments(folderId);
        void load();
      } else if (r?.error === 'bank_not_configured') {
        setPpError('Δεν έχεις IBAN. Ρυθμίσεις → Τραπεζικά στοιχεία πρώτα.');
      } else {
        setPpError('Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
      }
    } catch (e) {
      setPpError(e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Δεν δημιουργήθηκε. Δοκίμασε ξανά.');
    } finally {
      setPpBusy(false);
    }
  }

  // Stage 8f: owner confirms (or cancels) a payment request. 'confirmed' is the
  // only authoritative state — the customer's 'declared' is just a self-report.
  async function confirmPayment(folderId: string, paymentId: string, status: 'confirmed' | 'cancelled') {
    setBusyKey(`pay:${paymentId}:${status}`);
    try {
      const r = await apiPatch<{ ok?: boolean; error?: string }>(`/api/payments/${paymentId}`, { status });
      if (r?.ok) {
        Alert.alert('', status === 'confirmed' ? 'Η πληρωμή επιβεβαιώθηκε' : 'Το αίτημα ακυρώθηκε');
        void loadFolderPayments(folderId);
      } else if (r?.error === 'payment_not_actionable') {
        Alert.alert('', 'Το αίτημα έχει ήδη διευθετηθεί.');
        void loadFolderPayments(folderId);
      } else {
        Alert.alert('Σφάλμα', 'Δεν ολοκληρώθηκε. Δοκίμασε ξανά.');
      }
    } catch (e) {
      const isNet = e instanceof ApiError && e.isNetwork;
      Alert.alert('Σφάλμα', isNet ? 'Έλεγξε τη σύνδεση.' : 'Δεν ολοκληρώθηκε. Δοκίμασε ξανά.');
    } finally {
      setBusyKey(null);
    }
  }

  function openCreate() {
    setTitle('');
    setNotes('');
    setStatus('open');
    setTitleError('');
    setCreateOpen(true);
  }

  async function createFolder() {
    const t = title.trim();
    if (!t) {
      setTitleError('Γράψε τίτλο έργου.');
      return;
    }
    if (t.length > 120) {
      setTitleError('Έως 120 χαρακτήρες.');
      return;
    }
    setSaving(true);
    try {
      const r = await apiPost<{ ok?: boolean; folder?: WorkFolder }>(`/api/customers/${customerId}/folders`, {
        title: t,
        notes: notes.trim() || null,
        status,
      });
      if (r?.ok) {
        setCreateOpen(false);
        Alert.alert('✓', 'Το έργο δημιουργήθηκε');
        void load();
      } else {
        Alert.alert('Σφάλμα', 'Το έργο δεν δημιουργήθηκε.');
      }
    } catch (e) {
      Alert.alert('Σφάλμα', e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Το έργο δεν δημιουργήθηκε.');
    } finally {
      setSaving(false);
    }
  }

  function openDetail(f: WorkFolder) {
    setDetail(f);
    setEditMode(false);
    setLinkUrl('');
    setLinkSent(false);
    setETitle(f.title);
    setENotes(f.notes ?? '');
    setEStatus(f.status);
    // WF-4: fetch real sections
    setFdetail(null);
    void loadFolderDetail(f.id);
    // Stage 8f: fetch payment requests
    setPayments([]);
    void loadFolderPayments(f.id);
  }

  // WF-2: create (draft) the public folder link, then send or share it.
  async function draftLink() {
    if (!detail) return;
    setLinkBusy(true);
    setLinkSent(false);
    try {
      const r = await apiPost<{ ok?: boolean; responseUrl?: string }>(`/api/folders/${detail.id}/link`, { mode: 'draft' });
      if (r?.ok && r.responseUrl) setLinkUrl(r.responseUrl);
      else Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε ο σύνδεσμος.');
    } catch (e) {
      Alert.alert('Σφάλμα', e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Δεν δημιουργήθηκε ο σύνδεσμος.');
    } finally {
      setLinkBusy(false);
    }
  }

  async function sendLink() {
    if (!detail || !linkUrl) return;
    setLinkBusy(true);
    try {
      const r = await apiPost<{ ok?: boolean; sent?: boolean; fallbackReason?: string }>(`/api/folders/${detail.id}/link`, {
        mode: 'send',
        responseUrl: linkUrl,
      });
      if (r?.ok && r.sent) {
        setLinkSent(true);
        Alert.alert('✓', 'Ο σύνδεσμος στάλθηκε.');
      } else {
        Alert.alert('Αποστολή', r?.fallbackReason === 'missing_mobile' ? 'Λείπει κινητό τηλέφωνο.' : 'Δεν στάλθηκε. Δοκίμασε ξανά.');
      }
    } catch (e) {
      Alert.alert('Σφάλμα', e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Δεν στάλθηκε. Δοκίμασε ξανά.');
    } finally {
      setLinkBusy(false);
    }
  }

  function shareLink() {
    if (!linkUrl) return;
    void Share.share({ message: linkUrl }).catch(() => {});
  }

  // Stage 6: «Προβολή ως πελάτης» — open the real public /f/[token] portal in an
  // in-app browser (drafting the link first if none exists yet). Shows the
  // customer's exact view; no native portal re-build needed.
  async function previewAsCustomer() {
    if (!detail) return;
    let url = linkUrl;
    if (!url) {
      setLinkBusy(true);
      try {
        const r = await apiPost<{ ok?: boolean; responseUrl?: string }>(`/api/folders/${detail.id}/link`, { mode: 'draft' });
        if (r?.ok && r.responseUrl) {
          url = r.responseUrl;
          setLinkUrl(r.responseUrl);
        }
      } catch (e) {
        Alert.alert('Σφάλμα', e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Δεν δημιουργήθηκε ο σύνδεσμος.');
      } finally {
        setLinkBusy(false);
      }
    }
    if (!url) {
      Alert.alert('Σφάλμα', 'Δεν δημιουργήθηκε ο σύνδεσμος.');
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // best-effort — never throws to the UI
    }
  }

  function closeDetail() {
    setDetail(null);
    setEditMode(false);
    setFdetail(null);
    setFdError(false);
    setAttachOpen(false);
    setNewOfferOpen(false);
    setNewApptOpen(false);
    setNewPaymentOpen(false);
    setPayments([]);
  }

  async function patchFolder(updates: Record<string, unknown>): Promise<boolean> {
    if (!detail) return false;
    setEBusy(true);
    try {
      const r = await apiPatch<{ ok?: boolean; folder?: WorkFolder }>(`/api/folders/${detail.id}`, updates);
      if (r?.ok && r.folder) {
        setDetail(r.folder);
        void load();
        return true;
      }
      Alert.alert('Σφάλμα', 'Η αποθήκευση απέτυχε.');
      return false;
    } catch (e) {
      Alert.alert('Σφάλμα', e instanceof ApiError && e.isNetwork ? 'Έλεγξε τη σύνδεση.' : 'Η αποθήκευση απέτυχε.');
      return false;
    } finally {
      setEBusy(false);
    }
  }

  async function saveEdit() {
    const t = eTitle.trim();
    if (!t) {
      Alert.alert('Σφάλμα', 'Γράψε τίτλο έργου.');
      return;
    }
    if (t.length > 120) {
      Alert.alert('Σφάλμα', 'Ο τίτλος είναι πολύ μεγάλος (έως 120).');
      return;
    }
    const ok = await patchFolder({ title: t, notes: eNotes.trim() || null, status: eStatus });
    if (ok) setEditMode(false);
  }

  async function archive() {
    await patchFolder({ status: 'archived' });
  }

  // Process (Διαδικασία): advance the step / complete the project.
  async function advanceStep() {
    if (!detail) return;
    const cur = clampStep(detail.step);
    const next = Math.min(cur + 1, ERGO_STEPS.length - 1);
    if (next === cur) return;
    await patchFolder({ step: next });
  }
  async function completeProject() {
    await patchFolder({ step: ERGO_STEPS.length - 1, status: 'done' });
  }

  return (
    <View style={styles.group}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.groupTitle}>
        Έργα
      </ThemedText>
      <View style={styles.card}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Brand.primary} />
            <ThemedText type="small" themeColor="textSecondary">
              Φορτώνουν τα έργα...
            </ThemedText>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <ThemedText type="small" themeColor="textSecondary">
              Δεν φορτώθηκαν τα έργα.
            </ThemedText>
            <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={() => void load()} />
          </View>
        ) : folders.length === 0 ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyRow}>
              Δεν υπάρχει έργο ακόμα.
            </ThemedText>
            <PrimaryButton label="Νέο έργο" onPress={openCreate} />
          </>
        ) : (
          <>
            {folders.map((f) => {
              const summary = countsSummary(f.counts);
              return (
                <Pressable
                  key={f.id}
                  onPress={() => openDetail(f)}
                  style={({ pressed }) => [styles.folderRow, pressed && styles.pressed]}>
                  <View style={styles.folderBody}>
                    <ThemedText type="smallBold" numberOfLines={1} style={styles.ink}>
                      {f.title}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {STATUS_LABELS[f.status] ?? f.status}
                      {f.updatedAt ? ` · ${formatDate(f.updatedAt)}` : ''}
                    </ThemedText>
                    <ThemedText type="small" numberOfLines={1} style={{ color: Brand.primary, fontWeight: '600' }}>
                      {ergoStepCaption(f.step)}
                    </ThemedText>
                    {summary ? (
                      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                        {summary}
                      </ThemedText>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </Pressable>
              );
            })}
            <PrimaryButton label="Νέο έργο" tone="outline" onPress={openCreate} />
          </>
        )}
      </View>

      {/* Create sheet */}
      <SheetModal visible={createOpen} title="Νέο έργο" onClose={() => setCreateOpen(false)}>
        <Input
          label="Τίτλος έργου"
          value={title}
          onChangeText={(v) => {
            setTitle(v);
            if (titleError) setTitleError('');
          }}
          placeholder="π.χ. Τοποθέτηση κλιματιστικού"
        />
        {titleError ? (
          <ThemedText type="small" style={styles.err}>
            {titleError}
          </ThemedText>
        ) : null}
        <Input label="Σημειώσεις" value={notes} onChangeText={setNotes} placeholder="προαιρετικά" multiline />
        <ThemedText type="small" themeColor="textSecondary">
          Κατάσταση
        </ThemedText>
        <ChipSelect options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        <PrimaryButton label="Δημιουργία έργου" busy={saving} onPress={() => void createFolder()} />
      </SheetModal>

      {/* Detail / edit sheet */}
      <SheetModal visible={!!detail} title={detail?.title ?? 'Έργο'} onClose={closeDetail}>
        {detail ? (
          editMode ? (
            <>
              <Input label="Τίτλος έργου" value={eTitle} onChangeText={setETitle} placeholder="π.χ. Τοποθέτηση κλιματιστικού" />
              <Input label="Σημειώσεις" value={eNotes} onChangeText={setENotes} placeholder="προαιρετικά" multiline />
              <ThemedText type="small" themeColor="textSecondary">
                Κατάσταση
              </ThemedText>
              <ChipSelect options={STATUS_OPTIONS} value={eStatus} onChange={setEStatus} />
              <PrimaryButton label="Αποθήκευση" busy={eBusy} onPress={() => void saveEdit()} />
              <PrimaryButton label="Ακύρωση" tone="outline" onPress={() => setEditMode(false)} />
            </>
          ) : (
            <>
              <View style={styles.detailBadge}>
                <ThemedText style={styles.detailBadgeText}>{STATUS_LABELS[detail.status] ?? detail.status}</ThemedText>
              </View>

              {/* Διαδικασία — process stepper + step controls */}
              <WorkFolderStepper step={detail.step} c={c} />
              <PrimaryButton label="Προβολή ως πελάτης" tone="outline" busy={linkBusy} onPress={() => void previewAsCustomer()} />
              {clampStep(detail.step) < ERGO_STEPS.length - 1 || (detail.status !== 'done' && detail.status !== 'archived') ? (
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  {clampStep(detail.step) < ERGO_STEPS.length - 1 ? (
                    <View style={{ flex: 1 }}>
                      <PrimaryButton label="Παράλειψη βήματος" tone="outline" busy={eBusy} onPress={() => void advanceStep()} />
                    </View>
                  ) : null}
                  {detail.status !== 'done' && detail.status !== 'archived' ? (
                    <View style={{ flex: 1 }}>
                      <PrimaryButton label="Ολοκλήρωση" tone="outline" busy={eBusy} onPress={() => void completeProject()} />
                    </View>
                  ) : null}
                </View>
              ) : null}
              {detail.notes ? (
                <ThemedText type="small" style={styles.ink}>
                  {detail.notes}
                </ThemedText>
              ) : null}
              {countsSummary(detail.counts) ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {countsSummary(detail.counts)}
                </ThemedText>
              ) : null}
              {/* WF-4: real folder sections */}
              {fdLoading ? (
                <View style={styles.fdCenter}>
                  <ThemedText type="small" themeColor="textSecondary">Φορτώνει...</ThemedText>
                </View>
              ) : fdError ? (
                <View style={styles.fdCenter}>
                  <ThemedText type="small" themeColor="textSecondary">Δεν φορτώθηκαν τα στοιχεία.</ThemedText>
                  <PrimaryButton label="Δοκίμασε ξανά" tone="outline" onPress={() => detail && void loadFolderDetail(detail.id)} />
                </View>
              ) : fdetail ? (
                <>
                  {/* Action buttons row */}
                  <View style={styles.actionRow}>
                    <View style={styles.actionBtn}>
                      <PrimaryButton
                        label="Σύνδεση υπάρχοντος"
                        tone="outline"
                        onPress={() => void openAttachSheet(fdetail.folder.id)}
                      />
                    </View>
                    <View style={styles.actionBtn}>
                      <PrimaryButton
                        label="Νέα προσφορά"
                        tone="outline"
                        onPress={() => {
                          setQoDesc('');
                          setQoAmount('');
                          setQoError('');
                          setNewOfferOpen(true);
                        }}
                      />
                    </View>
                    <View style={styles.actionBtn}>
                      <PrimaryButton
                        label="Νέο ραντεβού"
                        tone="outline"
                        onPress={() => {
                          setQaTitle('');
                          setQaType('book_appointment');
                          setQaDate(todayYMD());
                          setQaError('');
                          setNewApptOpen(true);
                        }}
                      />
                    </View>
                  </View>

                  {/* Section: Προσφορές */}
                  <FdSection title="Προσφορές" count={fdetail.sections.offers.count} c={c} styles={styles}>
                    {fdetail.sections.offers.items.length === 0 ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
                    ) : (
                      fdetail.sections.offers.items.map((o) => (
                        <FdRow
                          key={o.id}
                          primary={o.offerNumber ?? '—'}
                          secondary={`${OFFER_STATUS_GR[o.status] ?? o.status}${o.total != null ? ` · ${money(o.total)}` : ''}`}
                          busy={busyKey === `offer:${o.id}`}
                          detachLabel="Αφαίρεση από έργο"
                          onDetach={() => void setFolderLink(fdetail.folder.id, 'offer', o.id, false)}
                          styles={styles}
                          c={c}
                        />
                      ))
                    )}
                  </FdSection>

                  {/* Section: Ραντεβού */}
                  <FdSection title="Ραντεβού" count={fdetail.sections.appointments.count} c={c} styles={styles}>
                    {fdetail.sections.appointments.items.length === 0 ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
                    ) : (
                      fdetail.sections.appointments.items.map((a) => (
                        <FdRow
                          key={a.id}
                          primary={a.title}
                          secondary={`${APPT_TYPE_GR[a.type] ?? 'Ραντεβού'}${a.dueDate ? ` · ${formatDate(a.dueDate)}` : ''}${a.dueTime ? ` ${a.dueTime}` : ''}`}
                          busy={busyKey === `task:${a.id}`}
                          detachLabel="Αφαίρεση από έργο"
                          onDetach={() => void setFolderLink(fdetail.folder.id, 'task', a.id, false)}
                          styles={styles}
                          c={c}
                        />
                      ))
                    )}
                  </FdSection>

                  {/* Section: Πληρωμή (Stage 8f) */}
                  <FdSection title="Πληρωμή" count={payments.length} c={c} styles={styles}>
                    {fdetail.sections.offers.items.length > 0 ? (
                      <PrimaryButton label="Νέο αίτημα πληρωμής" tone="outline" onPress={openNewPayment} />
                    ) : (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Πρόσθεσε πρώτα μια προσφορά.</ThemedText>
                    )}
                    {payments.map((p) => (
                      <PaymentFdRow
                        key={p.id}
                        p={p}
                        busyKey={busyKey}
                        onConfirm={() => void confirmPayment(fdetail.folder.id, p.id, 'confirmed')}
                        onCancel={() => void confirmPayment(fdetail.folder.id, p.id, 'cancelled')}
                        styles={styles}
                        c={c}
                      />
                    ))}
                  </FdSection>

                  {/* Section: Μηνύματα */}
                  <FdSection title="Μηνύματα" count={fdetail.sections.messages.count} c={c} styles={styles}>
                    {fdetail.sections.messages.items.length === 0 ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
                    ) : (
                      fdetail.sections.messages.items.map((m) => (
                        <FdRow
                          key={m.id}
                          primary={m.summary ?? '—'}
                          secondary={formatDate(m.createdAt)}
                          busy={busyKey === `communication:${m.id}`}
                          detachLabel="Αφαίρεση από έργο"
                          onDetach={() => void setFolderLink(fdetail.folder.id, 'communication', m.id, false)}
                          styles={styles}
                          c={c}
                        />
                      ))
                    )}
                  </FdSection>

                  {/* Section: Φωτογραφίες */}
                  <FdSection title="Φωτογραφίες" count={fdetail.sections.photos.count} c={c} styles={styles}>
                    <PrimaryButton
                      label="Ζήτα φωτογραφίες"
                      tone="outline"
                      busy={busyKey === 'req:upload'}
                      onPress={() => {
                        const cid = fdetail.customer?.id;
                        if (cid) void sendFolderRequest(fdetail.folder.id, cid, 'upload');
                      }}
                    />
                    {fdetail.sections.photos.items.length === 0 ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
                    ) : (
                      fdetail.sections.photos.items.map((u) => (
                        <FdRow
                          key={u.id}
                          primary={REQ_STATUS_GR[u.status] ?? u.status}
                          secondary={`Αίτημα φωτογραφιών · ${formatDate(u.createdAt)}`}
                          busy={busyKey === `upload_token:${u.id}`}
                          detachLabel="Αφαίρεση από έργο"
                          onDetach={() => void setFolderLink(fdetail.folder.id, 'upload_token', u.id, false)}
                          styles={styles}
                          c={c}
                        />
                      ))
                    )}
                  </FdSection>

                  {/* Section: Στοιχεία πελάτη */}
                  <FdSection title="Στοιχεία πελάτη" c={c} styles={styles}>
                    {fdetail.customer ? (
                      <View style={styles.customerBlock}>
                        <ThemedText type="smallBold" style={styles.ink}>{fdetail.customer.name ?? 'Πελάτης'}</ThemedText>
                        {fdetail.customer.phone ? <ThemedText type="small" themeColor="textSecondary">{fdetail.customer.phone}</ThemedText> : null}
                        {fdetail.customer.email ? <ThemedText type="small" themeColor="textSecondary">{fdetail.customer.email}</ThemedText> : null}
                      </View>
                    ) : null}
                    <PrimaryButton
                      label="Ζήτα στοιχεία"
                      tone="outline"
                      busy={busyKey === 'req:intake'}
                      onPress={() => {
                        const cid = fdetail.customer?.id;
                        if (cid) void sendFolderRequest(fdetail.folder.id, cid, 'intake');
                      }}
                    />
                    {fdetail.sections.intake.items.length === 0 && !fdetail.customer ? (
                      <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
                    ) : fdetail.sections.intake.items.length === 0 ? null : (
                      fdetail.sections.intake.items.map((i) => (
                        <FdRow
                          key={i.id}
                          primary={REQ_STATUS_GR[i.status] ?? i.status}
                          secondary={`Αίτημα στοιχείων · ${formatDate(i.createdAt)}`}
                          busy={busyKey === `intake_token:${i.id}`}
                          detachLabel="Αφαίρεση από έργο"
                          onDetach={() => void setFolderLink(fdetail.folder.id, 'intake_token', i.id, false)}
                          styles={styles}
                          c={c}
                        />
                      ))
                    )}
                  </FdSection>
                </>
              ) : null}

              {/* Public folder link — send/share to the customer (WF-2) */}
              <View style={styles.linkBox}>
                <ThemedText type="smallBold" style={styles.ink}>
                  Σύνδεσμος για τον πελάτη
                </ThemedText>
                {!linkUrl ? (
                  <PrimaryButton label="Δημιουργία συνδέσμου" tone="outline" busy={linkBusy} onPress={() => void draftLink()} />
                ) : (
                  <>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {linkUrl}
                    </ThemedText>
                    <PrimaryButton label="Αποστολή (Viber → SMS)" busy={linkBusy} onPress={() => void sendLink()} />
                    <PrimaryButton label="Κοινοποίηση" tone="outline" onPress={shareLink} />
                    {linkSent ? (
                      <ThemedText type="small" style={styles.sentText}>
                        Ο σύνδεσμος στάλθηκε.
                      </ThemedText>
                    ) : null}
                  </>
                )}
              </View>

              <PrimaryButton
                label="Επεξεργασία"
                tone="outline"
                onPress={() => {
                  setETitle(detail.title);
                  setENotes(detail.notes ?? '');
                  setEStatus(detail.status);
                  setEditMode(true);
                }}
              />
              {detail.status !== 'archived' ? (
                <PrimaryButton label="Αρχειοθέτηση" tone="outline" busy={eBusy} onPress={() => void archive()} />
              ) : null}
            </>
          )
        ) : null}
      </SheetModal>

      {/* WF-4: Attach existing sheet */}
      <SheetModal visible={attachOpen} title="Σύνδεση με έργο" onClose={() => setAttachOpen(false)}>
        {attachLoading ? (
          <ThemedText type="small" themeColor="textSecondary">Φορτώνει...</ThemedText>
        ) : attachError ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">Δεν φορτώθηκαν τα στοιχεία.</ThemedText>
            <PrimaryButton
              label="Δοκίμασε ξανά"
              tone="outline"
              onPress={() => detail && void openAttachSheet(detail.id)}
            />
          </>
        ) : (
          <>
            <ThemedText type="smallBold" style={styles.ink}>Προσφορές</ThemedText>
            {attOffers.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
            ) : (
              attOffers.map((o) => (
                <View key={o.id} style={styles.pickRow}>
                  <View style={styles.pickRowBody}>
                    <ThemedText type="small" style={styles.ink} numberOfLines={1}>{o.offerNumber ?? '—'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {`${OFFER_STATUS_GR[o.status] ?? o.status}${o.total != null ? ` · ${money(o.total)}` : ''}`}
                    </ThemedText>
                  </View>
                  <PrimaryButton
                    label="Σύνδεση"
                    busy={busyKey === `offer:${o.id}`}
                    onPress={() => detail && void setFolderLink(detail.id, 'offer', o.id, true)}
                  />
                </View>
              ))
            )}
            <ThemedText type="smallBold" style={[styles.ink, styles.pickGroupLabel]}>Ραντεβού</ThemedText>
            {attAppts.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
            ) : (
              attAppts.map((a) => (
                <View key={a.id} style={styles.pickRow}>
                  <View style={styles.pickRowBody}>
                    <ThemedText type="small" style={styles.ink} numberOfLines={1}>{a.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {`${APPT_TYPE_GR[a.type] ?? 'Ραντεβού'}${a.dueDate ? ` · ${formatDate(a.dueDate)}` : ''}`}
                    </ThemedText>
                  </View>
                  <PrimaryButton
                    label="Σύνδεση"
                    busy={busyKey === `task:${a.id}`}
                    onPress={() => detail && void setFolderLink(detail.id, 'task', a.id, true)}
                  />
                </View>
              ))
            )}
            <ThemedText type="smallBold" style={[styles.ink, styles.pickGroupLabel]}>Μηνύματα</ThemedText>
            {attMsgs.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
            ) : (
              attMsgs.map((m) => (
                <View key={m.id} style={styles.pickRow}>
                  <View style={styles.pickRowBody}>
                    <ThemedText type="small" style={styles.ink} numberOfLines={1}>{m.summary ?? '—'}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{formatDate(m.createdAt)}</ThemedText>
                  </View>
                  <PrimaryButton
                    label="Σύνδεση"
                    busy={busyKey === `communication:${m.id}`}
                    onPress={() => detail && void setFolderLink(detail.id, 'communication', m.id, true)}
                  />
                </View>
              ))
            )}
            <ThemedText type="smallBold" style={[styles.ink, styles.pickGroupLabel]}>Στοιχεία</ThemedText>
            {attIntake.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
            ) : (
              attIntake.map((i) => (
                <View key={i.id} style={styles.pickRow}>
                  <View style={styles.pickRowBody}>
                    <ThemedText type="small" style={styles.ink} numberOfLines={1}>{REQ_STATUS_GR[i.status] ?? i.status}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{`Αίτημα στοιχείων · ${formatDate(i.createdAt)}`}</ThemedText>
                  </View>
                  <PrimaryButton
                    label="Σύνδεση"
                    busy={busyKey === `intake_token:${i.id}`}
                    onPress={() => detail && void setFolderLink(detail.id, 'intake_token', i.id, true)}
                  />
                </View>
              ))
            )}
            <ThemedText type="smallBold" style={[styles.ink, styles.pickGroupLabel]}>Φωτογραφίες</ThemedText>
            {attUpload.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptySection}>Δεν υπάρχει κάτι ακόμα.</ThemedText>
            ) : (
              attUpload.map((u) => (
                <View key={u.id} style={styles.pickRow}>
                  <View style={styles.pickRowBody}>
                    <ThemedText type="small" style={styles.ink} numberOfLines={1}>{REQ_STATUS_GR[u.status] ?? u.status}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>{`Αίτημα φωτογραφιών · ${formatDate(u.createdAt)}`}</ThemedText>
                  </View>
                  <PrimaryButton
                    label="Σύνδεση"
                    busy={busyKey === `upload_token:${u.id}`}
                    onPress={() => detail && void setFolderLink(detail.id, 'upload_token', u.id, true)}
                  />
                </View>
              ))
            )}
          </>
        )}
      </SheetModal>

      {/* WF-4: Quick-create offer sheet */}
      <SheetModal visible={newOfferOpen} title="Νέα προσφορά" onClose={() => setNewOfferOpen(false)}>
        <Input
          label="Περιγραφή"
          value={qoDesc}
          onChangeText={setQoDesc}
          placeholder="π.χ. Τοποθέτηση κλιματιστικού"
        />
        <Input
          label="Ποσό (€)"
          value={qoAmount}
          onChangeText={setQoAmount}
          placeholder="0"
          keyboardType="decimal-pad"
        />
        {qoError ? <ThemedText type="small" style={styles.err}>{qoError}</ThemedText> : null}
        <PrimaryButton
          label="Δημιουργία"
          busy={qoBusy}
          onPress={() => detail && void submitNewOffer(detail.id)}
        />
        <PrimaryButton label="Ακύρωση" tone="outline" onPress={() => setNewOfferOpen(false)} />
      </SheetModal>

      {/* WF-4: Quick-create appointment sheet */}
      <SheetModal visible={newApptOpen} title="Νέο ραντεβού" onClose={() => setNewApptOpen(false)}>
        <Input
          label="Τίτλος"
          value={qaTitle}
          onChangeText={setQaTitle}
          placeholder="π.χ. Επίσκεψη για μέτρηση"
        />
        <ThemedText type="small" themeColor="textSecondary">Τύπος</ThemedText>
        <ChipSelect options={APPT_TYPE_OPTIONS} value={qaType} onChange={setQaType} />
        <Input
          label="Ημερομηνία (ΕΕΕΕ-ΜΜ-ΗΗ)"
          value={qaDate}
          onChangeText={setQaDate}
          placeholder={todayYMD()}
        />
        {qaError ? <ThemedText type="small" style={styles.err}>{qaError}</ThemedText> : null}
        <PrimaryButton
          label="Δημιουργία"
          busy={qaBusy}
          onPress={() => detail && void submitNewAppt(detail.id)}
        />
        <PrimaryButton label="Ακύρωση" tone="outline" onPress={() => setNewApptOpen(false)} />
      </SheetModal>

      {/* Stage 8f: new payment request sheet */}
      <SheetModal visible={newPaymentOpen} title="Αίτημα πληρωμής" onClose={() => setNewPaymentOpen(false)}>
        {fdetail && fdetail.sections.offers.items.length > 0 ? (
          <>
            <ThemedText type="small" themeColor="textSecondary">Προσφορά</ThemedText>
            <ChipSelect
              options={fdetail.sections.offers.items.map((o) => ({ key: o.id, label: `${o.offerNumber ?? '—'}${o.total != null ? ` · ${money(o.total)}` : ''}` }))}
              value={ppOfferId ?? ''}
              onChange={(v) => setPpOfferId(v)}
            />
            <ThemedText type="small" themeColor="textSecondary">Τύπος</ThemedText>
            <ChipSelect options={PAYMENT_KIND_OPTIONS} value={ppKind} onChange={setPpKind} />
            <Input label="Ποσοστό %" value={ppPct} onChangeText={setPpPct} keyboardType="decimal-pad" />
            <PaymentAmountPreview offers={fdetail.sections.offers.items} offerId={ppOfferId} pct={ppPct} />
            {ppError ? <ThemedText type="small" style={styles.err}>{ppError}</ThemedText> : null}
            <PrimaryButton label="Δημιουργία" busy={ppBusy} onPress={() => detail && void submitNewPayment(detail.id)} />
            <PrimaryButton label="Ακύρωση" tone="outline" onPress={() => setNewPaymentOpen(false)} />
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">Πρόσθεσε πρώτα μια προσφορά.</ThemedText>
        )}
      </SheetModal>
    </View>
  );
}

const makeStyles = (c: ThemePalette) =>
  StyleSheet.create({
    group: { gap: 6 },
    groupTitle: { paddingHorizontal: 4, fontWeight: '700' },
    card: { backgroundColor: c.surface, borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
    center: { alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingVertical: Spacing.three },
    ink: { color: c.text },
    emptyRow: { paddingVertical: 4 },
    folderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: c.card, borderRadius: 12, padding: Spacing.three },
    folderBody: { flex: 1, gap: 2 },
    err: { color: '#D14343' },
    detailBadge: { alignSelf: 'flex-start', backgroundColor: Brand.primarySoft, paddingHorizontal: Spacing.three, paddingVertical: 4, borderRadius: 999 },
    detailBadgeText: { color: Brand.primary, fontSize: 13, fontWeight: '700' },
    placeholderBox: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three, gap: 4 },
    linkBox: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
    sentText: { color: '#1B8A4C', fontWeight: '700' },
    pressed: { opacity: 0.7 },
    // WF-4 styles
    fdCenter: { alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.two },
    actionRow: { gap: Spacing.two },
    actionBtn: { flex: 1 },
    fdSectionBox: { backgroundColor: c.surface, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
    fdSectionTitle: { color: c.text, fontWeight: '700' },
    fdRowBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: c.card, borderRadius: 10, padding: Spacing.two },
    fdRowBody: { flex: 1, gap: 2 },
    fdDetachBtn: { paddingHorizontal: Spacing.two, paddingVertical: 4 },
    fdDetachText: { color: c.textFaint, fontSize: 11 },
    emptySection: { paddingHorizontal: 2 },
    customerBlock: { gap: 2 },
    pickRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, backgroundColor: c.card, borderRadius: 10, padding: Spacing.two },
    pickRowBody: { flex: 1, gap: 2 },
    pickGroupLabel: { marginTop: Spacing.two },
  });

// ---------------------------------------------------------------------------
// WF-4 local presentational helpers (receive styles + c to avoid hook calls)
// ---------------------------------------------------------------------------

type Styles = ReturnType<typeof makeStyles>;

function FdSection({
  title,
  count,
  children,
  c,
  styles,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  c: ThemePalette;
  styles: Styles;
}) {
  return (
    <View style={styles.fdSectionBox}>
      <ThemedText type="small" style={styles.fdSectionTitle}>
        {title}{typeof count === 'number' && count > 0 ? ` · ${count}` : ''}
      </ThemedText>
      {children}
    </View>
  );
}

function FdRow({
  primary,
  secondary,
  busy,
  detachLabel,
  onDetach,
  styles,
  c,
}: {
  primary: string;
  secondary: string;
  busy: boolean;
  detachLabel: string;
  onDetach: () => void;
  styles: Styles;
  c: ThemePalette;
}) {
  return (
    <View style={styles.fdRowBox}>
      <View style={styles.fdRowBody}>
        <ThemedText type="small" numberOfLines={1} style={{ color: c.text, fontWeight: '600' }}>
          {primary}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {secondary}
        </ThemedText>
      </View>
      <Pressable onPress={onDetach} disabled={busy} style={styles.fdDetachBtn}>
        <ThemedText style={[styles.fdDetachText, busy && { opacity: 0.4 }]}>
          {busy ? '...' : detachLabel}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function PaymentFdRow({
  p,
  busyKey,
  onConfirm,
  onCancel,
  styles,
  c,
}: {
  p: BizPayment;
  busyKey: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  styles: Styles;
  c: ThemePalette;
}) {
  const isFinal = p.status === 'confirmed' || p.status === 'cancelled';
  const confirming = busyKey === `pay:${p.id}:confirmed`;
  const cancelling = busyKey === `pay:${p.id}:cancelled`;
  const busy = confirming || cancelling;
  return (
    <View style={styles.fdRowBox}>
      <View style={styles.fdRowBody}>
        <ThemedText type="small" numberOfLines={1} style={{ color: c.text, fontWeight: '600' }}>
          {(PAYMENT_KIND_GR[p.kind] ?? p.kind)} · {money(p.amount)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {(PAYMENT_STATUS_GR[p.status] ?? p.status)}{p.pct != null ? ` · ${p.pct}%` : ''}
        </ThemedText>
      </View>
      {!isFinal ? (
        <View style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center' }}>
          <Pressable onPress={onConfirm} disabled={busy} style={styles.fdDetachBtn}>
            <ThemedText style={[{ color: '#1B8A4C', fontSize: 11, fontWeight: '700' }, busy && { opacity: 0.4 }]}>
              {confirming ? '...' : 'Επιβεβαίωση'}
            </ThemedText>
          </Pressable>
          <Pressable onPress={onCancel} disabled={busy} style={styles.fdDetachBtn}>
            <ThemedText style={[styles.fdDetachText, busy && { opacity: 0.4 }]}>
              {cancelling ? '...' : 'Ακύρωση'}
            </ThemedText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PaymentAmountPreview({ offers, offerId, pct }: { offers: DetailOffer[]; offerId: string | null; pct: string }) {
  const offer = offers.find((o) => o.id === offerId);
  const total = offer?.total ?? null;
  const p = Number(pct.replace(',', '.'));
  if (total == null || !isFinite(p) || p <= 0 || p > 100) return null;
  const amount = Math.round(total * p) / 100;
  return (
    <ThemedText type="small" style={{ color: Brand.primary, fontWeight: '700' }}>
      Ποσό αιτήματος: €{amount.toLocaleString('el-GR')}
    </ThemedText>
  );
}
