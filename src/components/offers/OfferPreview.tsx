'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { loadState, updateOffer, deleteOffer, addTask } from '@/lib/storage';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type { Offer, OfferStatus, Task, Customer, BusinessProfile } from '@/lib/types';
import { fmtEur, lineTotal } from '@/lib/offer-calculations';
import OfferStatusBadge, { OFFER_STATUS_LABELS } from './OfferStatusBadge';
import SendOfferLink from './SendOfferLink';
import OfferAcceptanceDemoSection from './OfferAcceptanceDemoSection';
import DemoStepBanner from '@/components/common/DemoStepBanner';
import GuidedDemoBanner from '@/components/common/GuidedDemoBanner';

const ALL_STATUSES: OfferStatus[] = [
  'draft',
  'ready_to_send',
  'sent_manually',
  'accepted',
  'rejected',
  'expired',
];

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('el-GR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Backend mapping helpers
// ---------------------------------------------------------------------------

function mapBackendOffer(d: Record<string, unknown>): Offer {
  return {
    id: d.id as string,
    customerId: (d.customerId as string | null) ?? undefined,
    relatedTaskId: (d.relatedTaskId as string | null) ?? undefined,
    offerNumber: d.offerNumber as string,
    status: d.status as OfferStatus,
    offerDate: d.offerDate as string,
    // Map null validUntil to offerDate to avoid Invalid Date in the UI.
    validUntil: (d.validUntil as string | null) ?? (d.offerDate as string),
    items: (d.items as unknown as Offer['items']) ?? [],
    subtotal: d.subtotal as number,
    vatRate: d.vatRate as number,
    vatAmount: d.vatAmount as number,
    total: d.total as number,
    notes: (d.notes as string | null) ?? '',
    terms: (d.terms as string | null) ?? '',
    acceptanceText: (d.acceptanceText as string | null) ?? '',
    createdFromAi: (d.createdFromAi as boolean) ?? false,
    createdAt: d.createdAt as string,
    updatedAt: d.updatedAt as string,
  };
}

function mapBackendCustomer(d: Record<string, unknown>): Customer {
  const now = new Date().toISOString();
  return {
    id: d.id as string,
    name:
      (d.name as string | null) ??
      (d.companyName as string | null) ??
      (d.crmNumber as string | null) ??
      'Πελάτης',
    companyName: (d.companyName as string | null) ?? '',
    phone: (d.phone as string | null) ?? '',
    email: (d.email as string | null) ?? '',
    address: (d.address as string | null) ?? '',
    source: (d.source as Customer['source']) ?? 'manual_entry',
    status: (d.status as Customer['status']) ?? 'new_lead',
    preferredContactMethod:
      (d.preferredContactMethod as Customer['preferredContactMethod']) ?? 'phone',
    needsSummary: (d.needsSummary as string | null) ?? '',
    notes: (d.notes as string | null) ?? '',
    createdAt: (d.createdAt as string) ?? now,
    updatedAt: (d.updatedAt as string) ?? now,
    crmNumber: (d.crmNumber as string | null) ?? undefined,
    mobilePhone: (d.mobilePhone as string | null) ?? undefined,
    landlinePhone: (d.landlinePhone as string | null) ?? undefined,
    opportunityValue: (d.opportunityValue as number | null) ?? undefined,
  };
}

function mapBackendBusiness(d: Record<string, unknown>): BusinessProfile {
  const now = new Date().toISOString();
  return {
    id: (d.id as string) ?? '',
    businessName: (d.name as string | null) ?? '',
    businessType: ((d.type as string | null) ?? 'other') as BusinessProfile['businessType'],
    ownerName: '',
    phone: (d.phone as string | null) ?? '',
    email: (d.email as string | null) ?? '',
    address: (d.address as string | null) ?? '',
    vatNumber: (d.vat_number as string | null) ?? '',
    taxOffice: (d.tax_office as string | null) ?? '',
    logoDataUrl: (d.logo_url as string | null) ?? '',
    defaultVatRate: (d.default_vat_rate as number | null) ?? 24,
    defaultOfferTerms: (d.default_offer_terms as string | null) ?? '',
    defaultAcceptanceText: (d.default_acceptance_text as string | null) ?? '',
    preferredContactMethod:
      ((d.preferred_contact_method as string | null) ?? 'phone') as BusinessProfile['preferredContactMethod'],
    createdAt: (d.created_at as string) ?? now,
    updatedAt: (d.updated_at as string) ?? now,
    legalName: (d.legal_name as string | null) ?? undefined,
    tradeName: (d.trade_name as string | null) ?? undefined,
    ownerFirstName: (d.owner_first_name as string | null) ?? undefined,
    ownerLastName: (d.owner_last_name as string | null) ?? undefined,
    addressLine1: (d.address_line1 as string | null) ?? undefined,
    addressLine2: (d.address_line2 as string | null) ?? undefined,
    postalCode: (d.postal_code as string | null) ?? undefined,
    city: (d.city as string | null) ?? undefined,
    region: (d.region as string | null) ?? undefined,
    website: (d.website as string | null) ?? undefined,
  };
}

// ---------------------------------------------------------------------------

interface Props {
  offerId: string;
}

export default function OfferPreview({ offerId }: Props) {
  const router = useRouter();

  // Start with null so server render and first client render match.
  const [hydrated, setHydrated] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bp, setBp] = useState<BusinessProfile | null>(null);
  // Backend mode: set when offer was loaded from the real API.
  const [loadedFromBackend, setLoadedFromBackend] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Steps 131+132: task suggestion state
  const [acceptTaskState, setAcceptTaskState] = useState<'idle' | 'created' | 'duplicate'>('idle');
  const [rejectTaskState, setRejectTaskState] = useState<'idle' | 'created' | 'duplicate'>('idle');
  // Step 137: demo response undo state
  const [undoResponseState, setUndoResponseState] = useState<'idle' | 'done'>('idle');
  const [confirmingOfferDelete, setConfirmingOfferDelete] = useState(false);
  const [confirmingUndoResponse, setConfirmingUndoResponse] = useState(false);
  // Response link generation state (backend offers only).
  const [responseLinkState, setResponseLinkState] = useState<'idle' | 'generating' | 'copied' | 'manual_copy' | 'error'>('idle');
  const [responseLinkUrl, setResponseLinkUrl] = useState('');
  const [responseLinkError, setResponseLinkError] = useState('');
  // Appointment form state for accepted-offer task creation
  const [appointmentFormOpen, setAppointmentFormOpen] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [appointmentTime, setAppointmentTime] = useState('10:00');
  const [acceptTaskKind, setAcceptTaskKind] = useState<'appointment' | 'generic' | null>(null);
  const [confirmedAppointmentDate, setConfirmedAppointmentDate] = useState('');
  const [confirmedAppointmentTime, setConfirmedAppointmentTime] = useState('');
  const [appointmentEmailState, setAppointmentEmailState] = useState<'idle' | 'sending' | 'sent' | 'missing_config' | 'error'>('idle');
  const [appointmentEmailCopied, setAppointmentEmailCopied] = useState(false);
  const [appointmentEmailManualCopyVisible, setAppointmentEmailManualCopyVisible] = useState(false);
  const [confirmedAppointmentTaskId, setConfirmedAppointmentTaskId] = useState('');

  // Try backend first. Fall back to localStorage for demo/local offers.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Backend path: try session + API fetch.
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session) {
          tokenRef.current = session.access_token;
          const headers: HeadersInit = { Authorization: `Bearer ${session.access_token}` };

          const offerResp = await fetch(`/api/offers/${offerId}`, { headers });
          if (offerResp.ok) {
            const offerData = await offerResp.json();
            const backendOffer = mapBackendOffer(offerData.offer as Record<string, unknown>);

            let backendCustomer: Customer | null = null;
            if (backendOffer.customerId) {
              try {
                const custResp = await fetch(
                  `/api/customers/${backendOffer.customerId}`,
                  { headers }
                );
                if (custResp.ok) {
                  const custData = await custResp.json();
                  backendCustomer = mapBackendCustomer(
                    custData.customer as Record<string, unknown>
                  );
                }
              } catch { /* non-fatal */ }
            }

            let backendBp: BusinessProfile | null = null;
            try {
              const bpResp = await fetch('/api/businesses/me', { headers });
              if (bpResp.ok) {
                const bpData = await bpResp.json();
                backendBp = mapBackendBusiness(bpData.business as Record<string, unknown>);
              }
            } catch { /* non-fatal */ }

            if (!cancelled) {
              setOffer(backendOffer);
              setCustomer(backendCustomer);
              setBp(backendBp);
              setLoadedFromBackend(true);
              setHydrated(true);
            }
            return;
          }
          // Offer not found in backend (e.g. UUID not found, 404) - fall through to localStorage.
        }
      } catch { /* fall through to localStorage */ }

      // Fallback: localStorage (keeps demo routes working).
      const state = loadState();
      const foundOffer = (state.offers ?? []).find((o) => o.id === offerId) ?? null;
      const foundCustomer = foundOffer?.customerId
        ? (state.customers ?? []).find((c) => c.id === foundOffer.customerId) ?? null
        : null;
      const foundBp = state.businessProfile ?? null;
      if (!cancelled) {
        setOffer(foundOffer);
        setCustomer(foundCustomer);
        setBp(foundBp);
        setHydrated(true);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [offerId]);

  async function handleStatusChange(status: OfferStatus) {
    if (!offer) return;
    if (loadedFromBackend) {
      const token = tokenRef.current;
      if (!token) return;
      setActionError(null);
      const resp = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setOffer(mapBackendOffer(data.offer as Record<string, unknown>));
      } else {
        setActionError('Αποτυχία αλλαγής status. Δοκίμασε ξανά.');
      }
    } else {
      const updated = { ...offer, status, updatedAt: new Date().toISOString() };
      updateOffer(updated);
      setOffer(updated);
    }
  }

  function handleUpdateOffer(updated: Offer) {
    // Only called from OfferAcceptanceDemoSection, which is hidden for backend offers.
    updateOffer(updated);
    setOffer(updated);
  }

  async function handleMarkSent() {
    if (!offer) return;
    if (loadedFromBackend) {
      const token = tokenRef.current;
      if (!token) return;
      setActionError(null);
      const resp = await fetch(`/api/offers/${offer.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent_manually' }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setOffer(mapBackendOffer(data.offer as Record<string, unknown>));
      } else {
        setActionError('Αποτυχία ενημέρωσης. Δοκίμασε ξανά.');
      }
    } else {
      const updated: Offer = {
        ...offer,
        status: 'sent_manually',
        updatedAt: new Date().toISOString(),
      };
      updateOffer(updated);
      setOffer(updated);
    }
  }

  async function handleCreateFollowUpTask() {
    if (!offer) return;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 3);
    const now = new Date().toISOString();

    if (loadedFromBackend) {
      const token = tokenRef.current;
      if (!token) return;
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: offer.customerId ?? null,
          offerId: offer.id,
          title: `Follow-up προσφοράς ${offer.offerNumber}`,
          type: 'follow_up_offer',
          status: 'open',
          priority: 'normal',
          dueDate: dueDate.toISOString().split('T')[0],
          note: 'Follow-up μετά την αποστολή της προσφοράς μέσω email.',
          createdFromAi: false,
        }),
      });
    } else {
      const task: Task = {
        id: crypto.randomUUID(),
        customerId: offer.customerId,
        title: `Follow-up προσφοράς ${offer.offerNumber}`,
        type: 'follow_up_offer',
        status: 'open',
        priority: 'normal',
        dueDate: dueDate.toISOString().split('T')[0],
        note: 'Follow-up μετά την αποστολή της προσφοράς μέσω email.',
        createdFromAi: false,
        createdAt: now,
        updatedAt: now,
      };
      addTask(task);
    }
  }

  async function handleDelete() {
    if (!offer) return;
    if (loadedFromBackend) {
      const token = tokenRef.current;
      if (!token) return;
      setActionError(null);
      const resp = await fetch(`/api/offers/${offer.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        router.push('/offers');
      } else {
        setActionError('Αποτυχία διαγραφής. Δοκίμασε ξανά.');
        setConfirmingOfferDelete(false);
      }
      return;
    }
    deleteOffer(offerId);
    router.push('/offers');
  }

  // Step 137: reset demo response  -  for demo retry only
  function handleUndoResponse() {
    if (!offer) return;
    const now = new Date().toISOString();
    const cleanedNotes = (offer.notes ?? '')
      .split('\n')
      .filter(
        (l) =>
          !l.startsWith('Απάντηση μέσω demo link:') &&
          !l.startsWith('Αποδοχή demo') &&
          !l.startsWith('Απόρριψη demo')
      )
      .join('\n')
      .trim();
    const updated: Offer = {
      ...offer,
      status: 'sent_manually',
      notes: cleanedNotes,
      updatedAt: now,
    };
    updateOffer(updated);
    setOffer(updated);
    setUndoResponseState('done');
    setAcceptTaskState('idle');
    setRejectTaskState('idle');
  }

  // Step 131: suggest work-scheduling task after accepted offer
  async function handleCreateAcceptTask() {
    if (!offer) return;

    if (loadedFromBackend) {
      const token = tokenRef.current;
      if (!token) return;
      setActionError(null);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: offer.customerId ?? null,
          offerId: offer.id,
          title: `Προγραμμάτισε εργασία για προσφορά ${offer.offerNumber}`,
          type: 'other',
          status: 'open',
          priority: 'high',
          dueDate: tomorrow.toISOString().split('T')[0],
          note: `Η προσφορά ${offer.offerNumber} έγινε αποδεκτή. Προγραμμάτισε την εκτέλεση.`,
          createdFromAi: false,
        }),
      });
      if (resp.ok) {
        setAcceptTaskKind('generic');
        setAcceptTaskState('created');
      } else {
        setActionError('Αποτυχία δημιουργίας task. Δοκίμασε ξανά.');
      }
      return;
    }

    // Local/demo path
    const state = loadState();
    // Step 140: improved duplicate detection
    const hasDup = (state.tasks ?? []).some(
      (t) =>
        t.status === 'open' &&
        (t.offerId === offer.id ||
          (offer.customerId &&
            t.customerId === offer.customerId &&
            offer.offerNumber &&
            t.title.includes(offer.offerNumber)))
    );
    if (hasDup) { setAcceptTaskState('duplicate'); return; }
    const now = new Date().toISOString();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    addTask({
      id: crypto.randomUUID(),
      customerId: offer.customerId,
      offerId: offer.id,
      title: `Προγραμμάτισε εργασία για προσφορά ${offer.offerNumber}`,
      type: 'other',
      status: 'open',
      priority: 'high',
      dueDate: tomorrow.toISOString().split('T')[0],
      note: `Η προσφορά ${offer.offerNumber} έγινε αποδεκτή. Προγραμμάτισε την εκτέλεση.`,
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    });
    setAcceptTaskKind('generic');
    setAcceptTaskState('created');
  }

  async function handleCreateAppointmentTask() {
    if (!offer) return;

    if (loadedFromBackend) {
      const token = tokenRef.current;
      if (!token) return;
      setActionError(null);
      const resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: offer.customerId ?? null,
          offerId: offer.id,
          title: `Ραντεβού, προσφορά ${offer.offerNumber}`,
          type: 'book_appointment',
          status: 'open',
          priority: 'high',
          dueDate: appointmentDate,
          dueTime: appointmentTime,
          note: `Η προσφορά έγινε αποδεκτή. Ραντεβού: ${appointmentDate} ${appointmentTime}.`,
          createdFromAi: false,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const taskId =
          ((data.task as Record<string, unknown>)?.id as string | undefined) ??
          crypto.randomUUID();
        setAcceptTaskKind('appointment');
        setConfirmedAppointmentDate(appointmentDate);
        setConfirmedAppointmentTime(appointmentTime);
        setConfirmedAppointmentTaskId(taskId);
        setAcceptTaskState('created');
        setAppointmentFormOpen(false);
      } else {
        setActionError('Αποτυχία δημιουργίας task ραντεβού. Δοκίμασε ξανά.');
      }
      return;
    }

    // Local/demo path
    const state = loadState();
    const hasDup = (state.tasks ?? []).some(
      (t) =>
        t.status === 'open' &&
        (t.offerId === offer.id ||
          (offer.customerId &&
            t.customerId === offer.customerId &&
            offer.offerNumber &&
            t.title.includes(offer.offerNumber)))
    );
    if (hasDup) { setAcceptTaskState('duplicate'); return; }
    const now = new Date().toISOString();
    const taskId = crypto.randomUUID();
    addTask({
      id: taskId,
      customerId: offer.customerId,
      offerId: offer.id,
      title: `Ραντεβού, προσφορά ${offer.offerNumber}`,
      type: 'book_appointment',
      status: 'open',
      priority: 'high',
      dueDate: appointmentDate,
      dueTime: appointmentTime,
      note: `Η προσφορά έγινε αποδεκτή. Ραντεβού: ${appointmentDate} ${appointmentTime}.`,
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    });
    setAcceptTaskKind('appointment');
    setConfirmedAppointmentDate(appointmentDate);
    setConfirmedAppointmentTime(appointmentTime);
    setConfirmedAppointmentTaskId(taskId);
    setAcceptTaskState('created');
    setAppointmentFormOpen(false);
  }

  function buildAppointmentEmailText(): string {
    const greeting = customer?.name ? `Αγαπητέ/ή ${customer.name},` : 'Αγαπητέ/ή πελάτη,';
    const businessLine = bp?.businessName ? `\n${bp.businessName}` : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const responseLink = confirmedAppointmentTaskId
      ? `${origin}/appointment-response/${confirmedAppointmentTaskId}`
      : '';
    return [
      greeting,
      '',
      `Σας προτείνουμε ραντεβού σχετικά με την προσφορά ${offer?.offerNumber ?? ''}, την οποία αποδεχτήκατε.`,
      '',
      `Ημερομηνία: ${confirmedAppointmentDate}`,
      `Ώρα: ${confirmedAppointmentTime}`,
      '',
      'Παρακαλούμε επιβεβαιώστε ή προτείνετε εναλλακτική ημερομηνία μέσω του παρακάτω συνδέσμου:',
      responseLink,
      '',
      'Σημείωση: Ο σύνδεσμος λειτουργεί μόνο στον browser όπου δημιουργήθηκε η προσφορά. Τα δεδομένα αποθηκεύονται τοπικά.',
      '',
      `Με εκτίμηση,${businessLine}`,
    ].join('\n');
  }

  async function handleSendAppointmentEmail() {
    if (!customer?.email || !offer) return;
    setAppointmentEmailState('sending');
    const subject = `Πρόταση ραντεβού, προσφορά ${offer.offerNumber}`;
    const text = buildAppointmentEmailText();
    try {
      const token = tokenRef.current;
      const res = await fetch('/api/email/send-offer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ to: customer.email, subject, text }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (data.ok) {
        setAppointmentEmailState('sent');
      } else if (data.error === 'missing_email_config') {
        setAppointmentEmailState('missing_config');
      } else {
        setAppointmentEmailState('error');
      }
    } catch {
      setAppointmentEmailState('error');
    }
  }

  function handleCopyAppointmentEmail() {
    if (!offer) return;
    const text = buildAppointmentEmailText();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { setAppointmentEmailCopied(true); setTimeout(() => setAppointmentEmailCopied(false), 2500); },
        () => setAppointmentEmailManualCopyVisible(true)
      );
    } else {
      setAppointmentEmailManualCopyVisible(true);
    }
  }

  // Step 132: suggest follow-up task after rejected offer
  async function handleCreateRejectTask() {
    if (!offer) return;

    if (loadedFromBackend) {
      const token = tokenRef.current;
      if (!token) return;
      setActionError(null);
      const in3days = new Date();
      in3days.setDate(in3days.getDate() + 3);
      const resp = await fetch('/api/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: offer.customerId ?? null,
          offerId: offer.id,
          title: `Follow-up για απορριφθείσα προσφορά ${offer.offerNumber}`,
          type: 'follow_up_offer',
          status: 'open',
          priority: 'normal',
          dueDate: in3days.toISOString().split('T')[0],
          note: `Η προσφορά ${offer.offerNumber} απορρίφθηκε. Σκέψου follow-up ή αναθεώρηση τιμής.`,
          createdFromAi: false,
        }),
      });
      if (resp.ok) {
        setRejectTaskState('created');
      } else {
        setActionError('Αποτυχία δημιουργίας task. Δοκίμασε ξανά.');
      }
      return;
    }

    // Local/demo path
    const state = loadState();
    // Step 140: improved duplicate detection
    const hasDup = (state.tasks ?? []).some(
      (t) =>
        t.status === 'open' &&
        (t.offerId === offer.id ||
          (offer.customerId &&
            t.customerId === offer.customerId &&
            offer.offerNumber &&
            t.title.includes(offer.offerNumber)))
    );
    if (hasDup) { setRejectTaskState('duplicate'); return; }
    const now = new Date().toISOString();
    const in3days = new Date();
    in3days.setDate(in3days.getDate() + 3);
    addTask({
      id: crypto.randomUUID(),
      customerId: offer.customerId,
      offerId: offer.id,
      title: `Follow-up για απορριφθείσα προσφορά ${offer.offerNumber}`,
      type: 'follow_up_offer',
      status: 'open',
      priority: 'normal',
      dueDate: in3days.toISOString().split('T')[0],
      note: `Η προσφορά ${offer.offerNumber} απορρίφθηκε. Σκέψου follow-up ή αναθεώρηση τιμής.`,
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
    });
    setRejectTaskState('created');
  }

  // Response link generation (backend offers only).
  async function handleGenerateResponseLink() {
    if (!offer) return;
    const token = tokenRef.current;
    if (!token) return;

    setResponseLinkState('generating');
    setResponseLinkUrl('');
    setResponseLinkError('');

    try {
      const resp = await fetch(`/api/offers/${offer.id}/response-link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as { ok: boolean; responseUrl?: string; error?: string };

      if (!resp.ok || !data.ok || !data.responseUrl) {
        setResponseLinkState('error');
        setResponseLinkError('Αποτυχία δημιουργίας link. Δοκίμασε ξανά.');
        return;
      }

      const url = data.responseUrl;
      setResponseLinkUrl(url);

      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(url);
          setResponseLinkState('copied');
          setTimeout(() => setResponseLinkState('idle'), 2500);
        } catch {
          setResponseLinkState('manual_copy');
        }
      } else {
        setResponseLinkState('manual_copy');
      }
    } catch {
      setResponseLinkState('error');
      setResponseLinkError('Αποτυχία δημιουργίας link. Δοκίμασε ξανά.');
    }
  }

  // Stable loading shell - identical on server and first client render.
  if (!hydrated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-400 dark:text-zinc-500">Φόρτωση προσφοράς...</p>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Η προσφορά δεν βρέθηκε.</p>
        <button
          type="button"
          onClick={() => router.push('/offers')}
          className="mt-4 text-sm text-indigo-600"
        >
          ← Πίσω στις προσφορές
        </button>
      </div>
    );
  }

  const customerName = customer?.name;

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 space-y-5">

      {/* Action error banner */}
      {actionError && (
        <div className="rounded-xl bg-red-50 dark:bg-red-500/15 px-4 py-2.5 ring-1 ring-red-200 dark:ring-red-500/20 print:hidden">
          <p className="text-sm text-red-700 dark:text-red-300">{actionError}</p>
        </div>
      )}

      {/* Step 165: Demo mission banners - only for demo/local offers */}
      {!loadedFromBackend && (
        <>
          <DemoStepBanner
            step="offer"
            stepNum={6}
            title="Προσφορά -- preview, print, copy draft"
            body="Δοκίμασε print PDF, αντιγραφή Viber/email draft και άνοιξε το demo response link παρακάτω."
            watchLabel="Ενότητα 'Link αποδοχής πελάτη' -- πάτα 'Άνοιγμα demo link πελάτη'."
            actionLabel="Επόμενο: Απάντηση πελάτη"
            actionHref={`/offer-response/${offerId}?demoStep=response`}
          />
          <DemoStepBanner
            step="followup"
            stepNum={8}
            title="Follow-up task -- μετά την αποδοχή"
            body="Η προσφορά αποδέχτηκε. Δημιούργησε task για προγραμματισμό εργασίας."
            watchLabel="Ενότητα 'Επόμενο βήμα' -- πάτα 'Δημιουργία task'."
            actionLabel="Πίσω στο Demo"
            actionHref="/demo"
          />
          <GuidedDemoBanner
            step="offer"
            stepNum={6}
            title="Προσφορά  -  preview, print, link αποδοχής"
            whatYouSee="Preview προσφοράς, print/PDF, copy draft για Viber/email, link αποδοχής πελάτη."
            whatToDo="Δοκίμασε print ή copy draft. Βρες την ενότητα 'Link αποδοχής πελάτη' και πάτα 'Άνοιγμα demo link πελάτη'."
            whyItMatters="Στο τελικό προϊόν, το link αποστέλλεται μέσω SMS, Viber ή email ανάλογα με το κανάλι του πελάτη. Στο MVP: copy-paste χειροκίνητα."
            canManualComplete={true}
          />
          <GuidedDemoBanner
            step="followup"
            stepNum={8}
            title="Follow-up task  -  μετά την αποδοχή"
            whatYouSee="Ενότητα 'Επόμενο βήμα' με κουμπί δημιουργίας task προγραμματισμού."
            whatToDo="Πάτα 'Δημιούργησε task προγραμματισμού' για να δημιουργηθεί task στο CRM."
            whyItMatters="Κάθε αποδεκτή προσφορά γίνεται task. Στο τελικό προϊόν, αυτό θα γίνεται αυτόματα μετά την αποδοχή."
            canManualComplete={false}
            isCompleted={acceptTaskState === 'created' || acceptTaskState === 'duplicate'}
            isFinalStep={true}
          />
        </>
      )}

      {/* Back + actions */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <button
          type="button"
          onClick={() => router.push('/offers')}
          className="flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          ← Προσφορές
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-3 py-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5"
        >
          <svg className="h-4 w-4" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
          </svg>
          Αποθήκευση ως PDF
        </button>
      </div>

      {/* Page title */}
      <div className="flex items-center justify-between gap-3 print:hidden">
        <h1 className="text-base font-semibold text-zinc-700 dark:text-zinc-200">Προεπισκόπηση προσφοράς</h1>
        {offer.isDemo && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-600">Demo</span>
        )}
      </div>

      {/* PDF-style document */}
      <div className="offer-print-document rounded-2xl bg-white dark:bg-[#17232f] p-6 shadow-sm ring-1 ring-zinc-100 dark:ring-white/10 space-y-5">

        {/* Header row: business + offer meta */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div>
            {bp?.logoDataUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={bp.logoDataUrl} alt="Logo" className="mb-2 h-12 w-auto object-contain" />
            )}
            {(() => {
              const primaryName = bp?.legalName || bp?.businessName || 'Επωνυμία επιχείρησης';
              const showTrade =
                bp?.tradeName &&
                bp.tradeName.trim() !== primaryName.trim();
              const addrLine1 = bp?.addressLine1 || bp?.address;
              const postalCity = [bp?.postalCode, bp?.city]
                .filter(Boolean).join(' ');
              return (
                <>
                  <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{primaryName}</p>
                  {showTrade && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{bp!.tradeName}</p>
                  )}
                  {bp?.phone   && <p className="text-sm text-zinc-500 dark:text-zinc-400">{bp.phone}</p>}
                  {bp?.email   && <p className="text-sm text-zinc-500 dark:text-zinc-400">{bp.email}</p>}
                  {bp?.website && <p className="text-sm text-zinc-500 dark:text-zinc-400">{bp.website}</p>}
                  {addrLine1   && <p className="text-sm text-zinc-500 dark:text-zinc-400">{addrLine1}</p>}
                  {bp?.addressLine2 && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">{bp.addressLine2}</p>
                  )}
                  {postalCity  && <p className="text-sm text-zinc-500 dark:text-zinc-400">{postalCity}</p>}
                  {bp?.region  && <p className="text-sm text-zinc-500 dark:text-zinc-400">{bp.region}</p>}
                  {bp?.vatNumber  && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">ΑΦΜ: {bp.vatNumber}</p>
                  )}
                  {bp?.taxOffice  && (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">ΔΟΥ: {bp.taxOffice}</p>
                  )}
                </>
              );
            })()}
          </div>
          <div className="sm:text-right">
            <p className="text-xl font-bold text-zinc-900 dark:text-zinc-100">ΠΡΟΣΦΟΡΑ {offer.offerNumber}</p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Ημερομηνία: {formatDate(offer.offerDate)}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Ισχύει μέχρι: {formatDate(offer.validUntil)}</p>
            <div className="mt-2">
              <OfferStatusBadge status={offer.status} />
            </div>
          </div>
        </div>

        {/* Customer info */}
        {customer && (
          <div className="rounded-xl bg-zinc-50 dark:bg-[#1e2b38] p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Πελάτης</p>
            <p className="font-semibold text-zinc-800 dark:text-zinc-200">{customer.name}</p>
            {customer.companyName && <p className="text-sm text-zinc-500 dark:text-zinc-400">{customer.companyName}</p>}
            {customer.phone && <p className="text-sm text-zinc-500 dark:text-zinc-400">{customer.phone}</p>}
            {customer.email && <p className="text-sm text-zinc-500 dark:text-zinc-400">{customer.email}</p>}
            {customer.address && <p className="text-sm text-zinc-500 dark:text-zinc-400">{customer.address}</p>}
          </div>
        )}

        {/* Line items */}
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-1/2" />
              <col className="w-[10%]" />
              <col className="w-[22%]" />
              <col className="w-[18%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/10 text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                <th className="pb-2 text-left font-medium">Περιγραφή</th>
                <th className="pb-2 text-right font-medium">Ποσ.</th>
                <th className="pb-2 text-right font-medium">Τιμή</th>
                <th className="pb-2 text-right font-medium">Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              {offer.items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100 dark:border-white/10">
                  <td className="py-2 pr-2 text-zinc-800 dark:text-zinc-200 break-words">
                    {item.description}
                  </td>
                  <td className="py-2 text-right text-zinc-600 dark:text-zinc-300">{item.quantity}</td>
                  <td className="py-2 text-right text-zinc-600 dark:text-zinc-300">{fmtEur(item.unitPrice)}</td>
                  <td className="py-2 text-right font-medium text-zinc-800 dark:text-zinc-200">{fmtEur(lineTotal(item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-full max-w-[16rem] space-y-1 text-sm">
            <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
              <span>Καθαρή αξία</span>
              <span>{fmtEur(offer.subtotal)}</span>
            </div>
            <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
              <span>ΦΠΑ {offer.vatRate}%</span>
              <span>{fmtEur(offer.vatAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-zinc-200 dark:border-white/10 pt-1.5 font-bold text-zinc-900 dark:text-zinc-100">
              <span>ΣΥΝΟΛΟ</span>
              <span>{fmtEur(offer.total)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {offer.notes && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Σημειώσεις</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{offer.notes}</p>
          </div>
        )}

        {/* Terms */}
        {offer.terms && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Όροι</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-wrap">{offer.terms}</p>
          </div>
        )}

        {/* Acceptance text */}
        {offer.acceptanceText && (
          <div className="rounded-xl border border-dashed border-zinc-300 dark:border-white/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">Κείμενο αποδοχής</p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{offer.acceptanceText}</p>
          </div>
        )}
      </div>

      {/* Status management */}
      <section className="rounded-2xl bg-white dark:bg-[#17232f] p-4 shadow-sm ring-1 ring-zinc-100 dark:ring-white/10 print:hidden">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Αλλαγή status
        </p>
        <select
          value={offer.status}
          onChange={(e) => handleStatusChange(e.target.value as OfferStatus)}
          className="w-full rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#0f1923] px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        >
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>{OFFER_STATUS_LABELS[s]}</option>
          ))}
        </select>
        {offer.status === 'sent_manually' && (
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
            Η προσφορά στάλθηκε χειροκίνητα εκτός της εφαρμογής. Η εφαρμογή δεν πραγματοποίησε αποστολή.
          </p>
        )}
      </section>

      {/* Send the acceptance link via Viber/SMS with an editable message */}
      {loadedFromBackend && (
        <SendOfferLink
          offerId={offer.id}
          bp={bp}
          onSent={() =>
            setOffer((o) =>
              o
                ? {
                    ...o,
                    status: o.status === 'draft' || o.status === 'ready_to_send' ? 'sent_manually' : o.status,
                    updatedAt: new Date().toISOString(),
                  }
                : o,
            )
          }
        />
      )}

      {/* Acceptance demo - only for demo/local offers */}
      {!loadedFromBackend && (
        <OfferAcceptanceDemoSection offer={offer} onUpdateOffer={handleUpdateOffer} />
      )}

      {/* Step 128: Response history card - only for demo/local offers */}
      {!loadedFromBackend && offer && (offer.status === 'accepted' || offer.status === 'rejected') && (
        <section className="rounded-2xl bg-white dark:bg-[#17232f] p-4 shadow-sm ring-1 ring-zinc-100 dark:ring-white/10 print:hidden">
          <div className="mb-3 flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              Απάντηση πελάτη
            </p>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              Τοπική απάντηση
            </span>
          </div>
          <div className={`rounded-xl px-4 py-3 ring-1 space-y-1 ${
            offer.status === 'accepted'
              ? 'bg-green-50 ring-green-200'
              : 'bg-red-50 ring-red-200'
          }`}>
            <p className={`text-sm font-semibold ${
              offer.status === 'accepted' ? 'text-green-700' : 'text-red-700'
            }`}>
              {offer.status === 'accepted'
                ? 'Η προσφορά έγινε αποδεκτή'
                : 'Η προσφορά απορρίφθηκε'}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Πηγή: demo link · τοπικό MVP
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Τελευταία ενημέρωση:{' '}
              {new Date(offer.updatedAt).toLocaleDateString('el-GR', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
            {offer.status === 'rejected' && offer.notes && (() => {
              const commentMatch = offer.notes.match(/Σχόλιο: (.+?)(?:\n|$)/);
              return commentMatch ? (
                <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1">
                  Σχόλιο: {commentMatch[1]}
                </p>
              ) : null;
            })()}
          </div>
          <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">
            Δεν αποτελεί νόμιμη ηλεκτρονική υπογραφή. Επικοινωνήστε με τον πελάτη για επιβεβαίωση.
          </p>
          {/* Step 137: demo-only undo response */}
          <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/10">
            {undoResponseState === 'done' ? (
              <div className="space-y-1.5">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Η απάντηση επαναφέρθηκε. Μπορείς να δοκιμάσεις ξανά το demo link.
                </p>
                {/* Step 150: demo replay link */}
                <a
                  href={`/offer-response/${offer.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                >
                  Άνοιγμα ξανά demo link
                </a>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  Το demo link λειτουργεί μόνο στον ίδιο browser.
                </p>
              </div>
            ) : confirmingUndoResponse ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Επαναφορά απάντησης demo;</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">
                  Η προσφορά θα επιστρέψει σε status &quot;Στάλθηκε χειροκίνητα&quot;. Μόνο για επανάληψη demo.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => { setConfirmingUndoResponse(false); handleUndoResponse(); }}
                    className="rounded-lg border border-zinc-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                  >
                    Ναι, επαναφορά
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingUndoResponse(false)}
                    className="rounded-lg border border-zinc-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-400 dark:text-zinc-500 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                  >
                    Πίσω
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingUndoResponse(true)}
                  className="rounded-xl border border-zinc-200 dark:border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                >
                  Επαναφορά απάντησης demo
                </button>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500">Για επανάληψη demo μόνο</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Step 131: Task suggestion for accepted offer */}
      {offer && offer.status === 'accepted' && (
        <section className="rounded-2xl border border-green-200 bg-green-50 p-4 print:hidden">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-green-600">
            Επόμενο βήμα
          </p>
          {acceptTaskState === 'created' ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-green-700">
                {acceptTaskKind === 'appointment' ? '✓ Το task ραντεβού δημιουργήθηκε.' : '✓ Το task δημιουργήθηκε.'}
              </p>
              {acceptTaskKind === 'appointment' && confirmedAppointmentDate && (
                <div className="rounded-xl border border-green-200 bg-white dark:bg-[#17232f] p-3 space-y-2">
                  <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Πρόταση ραντεβού, αναμονή απάντησης</p>
                  {!customer?.email ? (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">Δεν υπάρχει email πελάτη για αποστολή επιβεβαίωσης.</p>
                  ) : appointmentEmailState === 'sent' ? (
                    <p className="text-xs font-medium text-green-700">Στάλθηκε email πρότασης ραντεβού.</p>
                  ) : (appointmentEmailState === 'missing_config' || appointmentEmailState === 'error') ? (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-700">
                        {appointmentEmailState === 'missing_config'
                          ? 'Δεν έχει ρυθμιστεί αποστολή email στον server, οπότε δεν στάλθηκε email. Μπορείς να αντιγράψεις το κείμενο και να το στείλεις χειροκίνητα.'
                          : 'Σφάλμα αποστολής. Αντέγραψε το κείμενο για χειροκίνητη αποστολή.'}
                      </p>
                      <textarea
                        readOnly
                        rows={5}
                        value={buildAppointmentEmailText()}
                        className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0f1923] px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 font-mono leading-relaxed"
                      />
                      <button
                        type="button"
                        onClick={handleCopyAppointmentEmail}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${appointmentEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'}`}
                      >
                        {appointmentEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Αν η αποστολή email είναι ρυθμισμένη στον server, αυτό θα στείλει επιβεβαίωση ραντεβού στον πελάτη ({customer.email}).
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSendAppointmentEmail}
                          disabled={appointmentEmailState === 'sending'}
                          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {appointmentEmailState === 'sending' ? 'Αποστολή...' : 'Αποστολή πρότασης'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyAppointmentEmail}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${appointmentEmailCopied ? 'bg-green-100 text-green-700' : 'border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'}`}
                        >
                          {appointmentEmailCopied ? 'Αντιγράφηκε' : 'Αντιγραφή email'}
                        </button>
                      </div>
                      {appointmentEmailManualCopyVisible && (
                        <textarea
                          readOnly
                          rows={5}
                          value={buildAppointmentEmailText()}
                          className="w-full resize-none rounded-xl border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-[#0f1923] px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300 font-mono leading-relaxed"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : acceptTaskState === 'duplicate' ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Υπάρχει ήδη σχετικό task.</p>
          ) : appointmentFormOpen ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-700 dark:text-zinc-200">Επέλεξε ημερομηνία και ώρα ραντεβού:</p>
              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Ημερομηνία</label>
                  <input
                    type="date"
                    value={appointmentDate}
                    onChange={(e) => setAppointmentDate(e.target.value)}
                    className="rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">Ώρα</label>
                  <input
                    type="time"
                    value={appointmentTime}
                    onChange={(e) => setAppointmentTime(e.target.value)}
                    className="rounded-xl border border-zinc-200 dark:border-white/10 dark:bg-[#0f1923] px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCreateAppointmentTask}
                  disabled={!appointmentDate || !appointmentTime}
                  className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                >
                  Δημιουργία task ραντεβού
                </button>
                <button
                  type="button"
                  onClick={() => setAppointmentFormOpen(false)}
                  className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                >
                  Ακύρωση
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-700 dark:text-zinc-200">
                Ορίσε ραντεβού με τον πελάτη ή δημιούργησε γενικό task εκτέλεσης.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAppointmentFormOpen(true)}
                  className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700"
                >
                  Ορισμός ραντεβού
                </button>
                <button
                  type="button"
                  onClick={handleCreateAcceptTask}
                  className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
                >
                  Χωρίς ραντεβού τώρα
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Step 132: Rejection learning prompt */}
      {offer && offer.status === 'rejected' && (
        <section className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] p-4 print:hidden">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
            Μάθηση από απόρριψη
          </p>
          {offer.notes && (() => {
            const commentMatch = offer.notes.match(/Σχόλιο: (.+?)(?:\n|$)/);
            return commentMatch ? (
              <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">
                Λόγος: {commentMatch[1]}
              </p>
            ) : null;
          })()}
          <p className="text-sm text-zinc-700 dark:text-zinc-200 mb-3">
            Σκέψου follow-up ή αναθεώρηση προσφοράς.
          </p>
          {rejectTaskState === 'created' ? (
            <p className="text-sm font-medium text-indigo-600">✓ Το task δημιουργήθηκε.</p>
          ) : rejectTaskState === 'duplicate' ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Υπάρχει ήδη σχετικό task.</p>
          ) : (
            <button
              type="button"
              onClick={handleCreateRejectTask}
              className="rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200 transition hover:bg-zinc-50 dark:hover:bg-white/5"
            >
              Δημιουργία follow-up task
            </button>
          )}
        </section>
      )}

      {/* Delete */}
      <section className="rounded-2xl border border-red-100 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 p-4 print:hidden">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-400 dark:text-red-300/70">
          Ζώνη κινδύνου
        </h2>
        {confirmingOfferDelete ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Να διαγραφεί αυτή η προσφορά;</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Η προσφορά θα διαγραφεί οριστικά. Η ενέργεια δεν αναιρείται.</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Ναι, διαγραφή
              </button>
              <button
                type="button"
                onClick={() => setConfirmingOfferDelete(false)}
                className="rounded-xl border border-zinc-200 dark:border-white/10 px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-300 transition hover:bg-zinc-50 dark:hover:bg-white/5"
              >
                Πίσω
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingOfferDelete(true)}
            className="rounded-xl border border-red-200 dark:border-red-500/30 bg-white dark:bg-[#17232f] px-4 py-2 text-sm font-medium text-red-600 dark:text-red-300 transition hover:bg-red-50 dark:hover:bg-white/5"
          >
            Διαγραφή προσφοράς
          </button>
        )}
      </section>
    </div>
  );
}
