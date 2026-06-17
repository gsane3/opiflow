// Public, customer-facing read of a work folder for /f/[token] (WF-2).
//
// SECURITY: returns ONLY safe customer-facing fields. No internal IDs
// (business_id / customer_id / row ids), no auth, no business-only data. The
// token is validated first (findValidFolderToken: pending/sent/opened, not
// expired/revoked); any failure (invalid/expired/revoked token, missing folder,
// or DB error) resolves to null → the page shows a neutral "link unavailable"
// message (fail-closed, no information leak).

import { createServiceSupabaseClient } from './intake-tokens';
import { findValidFolderToken, markFolderTokenOpened, FOLDER_TOKEN_EXPIRY_HOURS } from './folder-tokens';
import { clampStep, isTerminalFolderStatus } from './work-folders';
import { offerCanRespond } from './offer-status';
import { appointmentCanRespond } from './appointment-status';
import { mapPublicPayment, type PublicPayment, type PaymentRequestRow } from './payments';

// Statuses shown on the public page. 'cancelled' is hidden; the customer only
// ever sees a request they should act on (pending), have acted on (declared),
// or that the owner has confirmed (confirmed).
const PUBLIC_PAYMENT_STATUSES = ['pending', 'declared', 'confirmed'] as const;

const APPOINTMENT_TASK_TYPES = ['book_appointment', 'visit_customer'] as const;

const FOLDER_STATUS_LABELS: Record<string, string> = {
  open: 'Νέο',
  in_progress: 'Σε εξέλιξη',
  done: 'Ολοκληρώθηκε',
  archived: 'Αρχειοθετήθηκε',
};

const FOLDER_STATUS_MESSAGES: Record<string, string> = {
  open: 'Νέα εργασία.',
  in_progress: 'Η εργασία είναι σε εξέλιξη.',
  done: 'Η εργασία ολοκληρώθηκε.',
  archived: 'Η εργασία αρχειοθετήθηκε.',
};

// Customer-facing offer status. Internal draft states are shown neutrally so the
// public page never exposes raw pipeline wording.
const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Σε ετοιμασία',
  ready_to_send: 'Σε ετοιμασία',
  sent_manually: 'Στάλθηκε',
  sent_provider: 'Στάλθηκε',
  accepted: 'Αποδεκτή',
  rejected: 'Απορρίφθηκε',
  expired: 'Έληξε',
  cancelled: 'Ακυρώθηκε',
};

const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  book_appointment: 'Ραντεβού',
  visit_customer: 'Επίσκεψη',
};

export function folderStatusLabel(status: string): string {
  return FOLDER_STATUS_LABELS[status] ?? status;
}
export function folderStatusMessage(status: string): string {
  return FOLDER_STATUS_MESSAGES[status] ?? '';
}

// ---------------------------------------------------------------------------
// Row shapes (only the safe columns are selected)
// ---------------------------------------------------------------------------

export interface FolderRowForPublic {
  title: string;
  status: string;
  // step (0..4) drives the portal Stepper. Non-sensitive progress only.
  // Optional → tolerant of pre-migration-047 rows (absent column → 0).
  step?: number | null;
  // Used only to fetch the customer's own first name for the portal greeting.
  customer_id?: string | null;
  // folder.notes is INTENTIONALLY excluded — it is internal business notes and
  // is never selected or exposed on the public page.
}
export interface BusinessRowForPublic {
  name: string | null;
  legal_name: string | null;
  trade_name: string | null;
  logo_url: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  // Bank details for deposit/balance transfers (migration 048). Optional →
  // tolerant of pre-048 rows. The beneficiary + bank name are the business's own
  // public details, needed so the customer can make the deposit; safe to expose.
  bank_name?: string | null;
  bank_beneficiary?: string | null;
  // Public contact links shown as icons on the portal hero (β).
  facebook_url?: string | null;
  instagram_url?: string | null;
}
export interface OfferRowForPublic {
  id: string;
  offer_number: string | null;
  status: string;
  total: number | null;
  valid_until: string | null;
  vat_rate?: number | null;
}
// Safe, customer-facing line of the customer's OWN offer (their quote).
export interface OfferItemRowForPublic {
  offer_id: string;
  description: string | null;
  line_total: number | null;
  sort_order?: number | null;
}
export interface TaskRowForPublic {
  id: string;
  due_date: string | null;
  due_time: string | null;
  type: string;
  status: string;
}
export interface MessageRowForPublic {
  direction: string;
  // channel is selected ONLY so the mapper can defensively drop call rows — the
  // query already excludes channel='call' (where AI call briefs live). It is
  // never exposed on the public view.
  channel: string;
  summary: string | null;
  created_at: string;
}
// Only the safe, customer-facing columns of a payment request. NEVER select pct,
// business_id, customer_id, offer_id, or the row's internal timestamps here.
export interface PaymentRowForPublic {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  status: string;
  receiving_account: string | null;
}

// ---------------------------------------------------------------------------
// Public view (no internal IDs / business-only fields)
// ---------------------------------------------------------------------------

export interface PublicFolderBusiness {
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  bankName: string | null;
  bankBeneficiary: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
}
export interface PublicFolderOffer {
  id: string;
  offerNumber: string;
  statusLabel: string;
  /** Gross total (incl. VAT). */
  total: number | null;
  /** VAT rate (%) for the «Σύνολο (με ΦΠΑ x%)» label. */
  vatRate: number | null;
  /** The offer's line items (description + line total) — the customer's own quote. */
  lines: { description: string; lineTotal: number }[];
  /** Authoritative accepted flag (status === 'accepted'), independent of the label. */
  accepted: boolean;
  /** Whether the customer can still accept this offer (not final, not expired). */
  canAccept: boolean;
}
export interface PublicFolderAppointment {
  id: string;
  date: string | null;
  time: string | null;
  typeLabel: string;
  /** Whether the customer can still confirm / request a time change. */
  canRespond: boolean;
}
export interface PublicFolderMessage {
  direction: 'in' | 'out';
  text: string;
  createdAt: string;
}
export interface PublicFolderView {
  business: PublicFolderBusiness | null;
  /** The customer's own first name, for the portal greeting (null if unknown). */
  greetingName: string | null;
  title: string;
  statusLabel: string;
  statusMessage: string;
  step: number;
  offers: PublicFolderOffer[];
  appointments: PublicFolderAppointment[];
  messages: PublicFolderMessage[];
  payments: PublicPayment[];
}

function mapPublicBusiness(row: BusinessRowForPublic | null): PublicFolderBusiness | null {
  if (!row) return null;
  const name = row.trade_name?.trim() || row.legal_name?.trim() || row.name?.trim() || null;
  if (!name && !row.logo_url) return null;
  return {
    name: name ?? 'Η επιχείρηση',
    logoUrl: row.logo_url,
    phone: row.phone,
    email: row.email,
    website: row.website,
    bankName: row.bank_name?.trim() || null,
    bankBeneficiary: row.bank_beneficiary?.trim() || null,
    facebookUrl: row.facebook_url?.trim() || null,
    instagramUrl: row.instagram_url?.trim() || null,
  };
}

/**
 * PURE — build the public view from the safe rows. Deliberately omits every
 * internal id and business-only field; this is the only data the customer sees.
 */
export function toPublicFolderView(
  folder: FolderRowForPublic,
  business: BusinessRowForPublic | null,
  offers: OfferRowForPublic[],
  appointments: TaskRowForPublic[],
  messages: MessageRowForPublic[] = [],
  payments: PaymentRowForPublic[] = [],
  greetingName: string | null = null,
  offerLines: Record<string, { description: string; lineTotal: number }[]> = {},
): PublicFolderView {
  return {
    business: mapPublicBusiness(business),
    greetingName,
    title: folder.title,
    statusLabel: folderStatusLabel(folder.status),
    statusMessage: folderStatusMessage(folder.status),
    step: clampStep(folder.step),
    // The customer↔business message exchange. `channel='call'` rows (which hold
    // internal AI call briefs) are excluded by BOTH the query and this filter.
    messages: messages
      .filter((m) => m.channel !== 'call' && typeof m.summary === 'string' && m.summary.trim().length > 0)
      .map((m) => ({
        direction: m.direction === 'outbound' ? ('out' as const) : ('in' as const),
        text: (m.summary as string).trim(),
        createdAt: m.created_at,
      })),
    offers: offers.map((o) => ({
      id: o.id,
      offerNumber: o.offer_number ?? '—',
      statusLabel: OFFER_STATUS_LABELS[o.status] ?? o.status,
      total: o.total,
      vatRate: o.vat_rate ?? null,
      lines: offerLines[o.id] ?? [],
      accepted: o.status === 'accepted',
      canAccept: offerCanRespond({ status: o.status, valid_until: o.valid_until }),
    })),
    appointments: appointments.map((t) => ({
      id: t.id,
      date: t.due_date,
      time: t.due_time,
      typeLabel: APPOINTMENT_TYPE_LABELS[t.type] ?? 'Ραντεβού',
      canRespond: appointmentCanRespond({ status: t.status, type: t.type, due_date: t.due_date }),
    })),
    // Defensive: even though the query filters by status, drop anything not in
    // the public allowlist before mapping to the safe shape.
    payments: payments
      .filter((p) => (PUBLIC_PAYMENT_STATUSES as readonly string[]).includes(p.status))
      .map((p) => mapPublicPayment(p as unknown as PaymentRequestRow)),
  };
}

/**
 * Validate the token and load the safe public folder view, or null for
 * invalid/expired/revoked/missing/error (fail-closed — never throws, never leaks).
 */
export async function loadPublicFolder(rawToken: string): Promise<PublicFolderView | null> {
  try {
    const token = await findValidFolderToken(rawToken);
    if (!token) return null;

    const supabase = createServiceSupabaseClient();

    // Folder, scoped by the token's business_id (defense in depth).
    const fPrimary = await supabase
      .from('work_folders')
      .select('title, status, step, customer_id') // NB: notes intentionally not selected (internal-only)
      .eq('id', token.work_folder_id)
      .eq('business_id', token.business_id)
      .maybeSingle();
    let folderData: unknown = fPrimary.data;
    let folderError = fPrimary.error;
    if (folderError) {
      // Pre-migration-047 fallback: retry without `step` (clampStep defaults to 0).
      const fb = await supabase
        .from('work_folders')
        .select('title, status, customer_id')
        .eq('id', token.work_folder_id)
        .eq('business_id', token.business_id)
        .maybeSingle();
      folderData = fb.data;
      folderError = fb.error;
    }
    if (folderError || !folderData) return null;
    const folder = folderData as unknown as FolderRowForPublic;

    const [bizRes, offersRes, apptRes, msgRes, payRes, custRes] = await Promise.all([
      supabase
        .from('businesses')
        .select('name, legal_name, trade_name, logo_url, phone, email, website, bank_name, bank_beneficiary, facebook_url, instagram_url')
        .eq('id', token.business_id)
        .maybeSingle(),
      supabase
        .from('offers')
        .select('id, offer_number, status, total, valid_until, vat_rate')
        .eq('business_id', token.business_id)
        .eq('work_folder_id', token.work_folder_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('tasks')
        .select('id, due_date, due_time, type, status')
        .eq('business_id', token.business_id)
        .eq('work_folder_id', token.work_folder_id)
        .in('type', APPOINTMENT_TASK_TYPES as unknown as string[])
        .order('due_date', { ascending: true }),
      // Q&A thread: only the customer↔business message channels. `channel='call'`
      // is EXCLUDED here (that is where internal AI call briefs live) — the single
      // load-bearing filter that keeps briefs off the public page. call_briefs /
      // journey_summary are never read.
      supabase
        .from('communications')
        .select('direction, channel, summary, created_at')
        .eq('business_id', token.business_id)
        .eq('work_folder_id', token.work_folder_id)
        .in('channel', ['sms', 'viber', 'email'])
        // Inbound customer messages are logged 'completed'; outbound business
        // messages go 'sent'→'delivered'→'seen' (Apifon status webhook). Show both
        // directions so the chat is two-way and project-update notifications appear.
        .in('status', ['completed', 'sent', 'delivered', 'seen'])
        .order('created_at', { ascending: true })
        .limit(50),
      // Payment requests — same triple-scoping (business_id + work_folder_id),
      // only the safe columns, only the public-facing statuses. Tolerant of
      // pre-migration-048 (table absent → error → empty, never throws).
      supabase
        .from('payment_requests')
        .select('id, kind, amount, currency, status, receiving_account')
        .eq('business_id', token.business_id)
        .eq('work_folder_id', token.work_folder_id)
        .in('status', PUBLIC_PAYMENT_STATUSES as unknown as string[])
        .order('created_at', { ascending: false }),
      // The customer's OWN first name for the portal greeting (their own data,
      // their own link). Scoped to this business; only `name` is selected.
      supabase
        .from('customers')
        .select('name')
        .eq('id', (folder.customer_id ?? '') as string)
        .eq('business_id', token.business_id)
        .maybeSingle(),
    ]);

    const business = (bizRes.data as unknown as BusinessRowForPublic | null) ?? null;
    const offers = ((offersRes.data ?? []) as unknown[]) as OfferRowForPublic[];
    const appointments = ((apptRes.data ?? []) as unknown[]) as TaskRowForPublic[];
    const messages = ((msgRes.data ?? []) as unknown[]) as MessageRowForPublic[];
    const payments = ((payRes.data ?? []) as unknown[]) as PaymentRowForPublic[];

    // The customer's OWN first name for the greeting.
    const custName = (custRes.data as { name?: string | null } | null)?.name ?? null;
    const greetingName = custName ? (custName.trim().split(/\s+/)[0] || null) : null;

    // Offer line items (the customer's own quote breakdown), scoped to this
    // business + the offers already scoped to this folder. Best-effort.
    const offerLines: Record<string, { description: string; lineTotal: number }[]> = {};
    const offerIds = offers.map((o) => o.id).filter(Boolean);
    if (offerIds.length > 0) {
      const itemsRes = await supabase
        .from('offer_items')
        .select('offer_id, description, line_total, sort_order')
        .eq('business_id', token.business_id)
        .in('offer_id', offerIds)
        .order('sort_order', { ascending: true });
      for (const row of ((itemsRes.data ?? []) as unknown[]) as OfferItemRowForPublic[]) {
        const list = offerLines[row.offer_id] ?? (offerLines[row.offer_id] = []);
        list.push({
          description: (row.description ?? '').trim(),
          lineTotal: typeof row.line_total === 'number' ? row.line_total : Number(row.line_total ?? 0),
        });
      }
    }

    // Best-effort "opened" tracking + rolling 30-day inactivity window: each open
    // pushes expiry forward WHILE the job is active. Once the folder reaches a
    // terminal status (done/archived) we stop extending, so the link closes 30
    // days after completion (the cap set on the terminal transition). Must not
    // block the page.
    void markFolderTokenOpened(token.id, {
      extendExpiryHours: isTerminalFolderStatus(folder.status) ? undefined : FOLDER_TOKEN_EXPIRY_HOURS,
    }).catch(() => {});

    return toPublicFolderView(folder, business, offers, appointments, messages, payments, greetingName, offerLines);
  } catch {
    return null;
  }
}
