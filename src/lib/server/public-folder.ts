// Public, customer-facing read of a work folder for /f/[token] (WF-2).
//
// SECURITY: returns ONLY safe customer-facing fields. No internal IDs
// (business_id / customer_id / row ids), no auth, no business-only data. The
// token is validated first (findValidFolderToken: pending/sent/opened, not
// expired/revoked); any failure (invalid/expired/revoked token, missing folder,
// or DB error) resolves to null → the page shows a neutral "link unavailable"
// message (fail-closed, no information leak).

import { createServiceSupabaseClient } from './intake-tokens';
import { findValidFolderToken, markFolderTokenOpened } from './folder-tokens';
import { clampStep } from './work-folders';
import { offerCanRespond } from './offer-status';
import { appointmentCanRespond } from './appointment-status';

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
}
export interface OfferRowForPublic {
  id: string;
  offer_number: string | null;
  status: string;
  total: number | null;
  valid_until: string | null;
}
export interface TaskRowForPublic {
  id: string;
  due_date: string | null;
  due_time: string | null;
  type: string;
  status: string;
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
}
export interface PublicFolderOffer {
  id: string;
  offerNumber: string;
  statusLabel: string;
  total: number | null;
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
export interface PublicFolderView {
  business: PublicFolderBusiness | null;
  title: string;
  statusLabel: string;
  statusMessage: string;
  step: number;
  offers: PublicFolderOffer[];
  appointments: PublicFolderAppointment[];
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
): PublicFolderView {
  return {
    business: mapPublicBusiness(business),
    title: folder.title,
    statusLabel: folderStatusLabel(folder.status),
    statusMessage: folderStatusMessage(folder.status),
    step: clampStep(folder.step),
    offers: offers.map((o) => ({
      id: o.id,
      offerNumber: o.offer_number ?? '—',
      statusLabel: OFFER_STATUS_LABELS[o.status] ?? o.status,
      total: o.total,
      canAccept: offerCanRespond({ status: o.status, valid_until: o.valid_until }),
    })),
    appointments: appointments.map((t) => ({
      id: t.id,
      date: t.due_date,
      time: t.due_time,
      typeLabel: APPOINTMENT_TYPE_LABELS[t.type] ?? 'Ραντεβού',
      canRespond: appointmentCanRespond({ status: t.status, type: t.type, due_date: t.due_date }),
    })),
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
    const { data: folderData, error: folderError } = await supabase
      .from('work_folders')
      .select('title, status, step') // NB: notes intentionally not selected (internal-only)
      .eq('id', token.work_folder_id)
      .eq('business_id', token.business_id)
      .maybeSingle();
    if (folderError || !folderData) return null;
    const folder = folderData as unknown as FolderRowForPublic;

    const [bizRes, offersRes, apptRes] = await Promise.all([
      supabase
        .from('businesses')
        .select('name, legal_name, trade_name, logo_url, phone, email, website')
        .eq('id', token.business_id)
        .maybeSingle(),
      supabase
        .from('offers')
        .select('id, offer_number, status, total, valid_until')
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
    ]);

    const business = (bizRes.data as unknown as BusinessRowForPublic | null) ?? null;
    const offers = ((offersRes.data ?? []) as unknown[]) as OfferRowForPublic[];
    const appointments = ((apptRes.data ?? []) as unknown[]) as TaskRowForPublic[];

    // Best-effort "opened" tracking — must not block the page.
    void markFolderTokenOpened(token.id).catch(() => {});

    return toPublicFolderView(folder, business, offers, appointments);
  } catch {
    return null;
  }
}
