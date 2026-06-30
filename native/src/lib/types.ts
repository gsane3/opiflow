// Shared API types — mirror the web app's /api/* response shapes (camelCase).

export interface Customer {
  id: string;
  crmNumber?: string | null;
  name: string | null;
  companyName?: string | null;
  /** End-customer ΑΦΜ (migration 067) — enables B2B 2.1 invoicing. */
  vatNumber?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  landlinePhone?: string | null;
  email?: string | null;
  address?: string | null;
  postalCode?: string | null;
  region?: string | null;
  source?: string | null;
  status?: 'new' | 'in_progress' | 'won' | 'lost' | null;
  opportunityValue?: number | null;
  needsSummary?: string | null;
  notes?: string | null;
  statusSummary?: string | null;
  businessNotes?: string | null;
  personalNotes?: string | null;
  nextBestAction?: string | null;
  lastContactAt?: string | null;
  createdAt?: string;
  pinned?: boolean;
  /** Imported from the phone address book (#9) — hideable in the list. */
  importedFromPhone?: boolean;
  /** A call happened and the intake request is still unfilled → floats to the top. */
  needsIntake?: boolean;
  /** Blocked contact — inbound calls are rejected (migration 058). */
  blocked?: boolean;
}

export interface Task {
  id: string;
  customerId: string | null;
  title: string;
  type: string;
  status: 'open' | 'completed' | 'cancelled' | 'ai_draft';
  priority?: 'low' | 'normal' | 'high';
  dueDate: string; // YYYY-MM-DD
  dueTime?: string | null; // HH:MM
  note?: string | null;
  createdAt?: string;
}

export interface OfferItem {
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal?: number;
  sortOrder?: number;
}

export interface Offer {
  id: string;
  customerId: string | null;
  offerNumber: string;
  status: string;
  items: OfferItem[];
  subtotal?: number;
  vatAmount?: number;
  total: number;
  notes?: string | null;
  createdAt?: string;
}

export interface Communication {
  id: string;
  customerId: string | null;
  channel: 'call' | 'sms' | 'viber' | 'email';
  direction: 'inbound' | 'outbound';
  status: string;
  phone: string | null;
  summary: string | null;
  createdAt: string;
  customer?: { id: string; name: string | null } | null;
}

/** Unified per-customer chat feed item (GET /api/customers/[id]/timeline). */
export interface TimelineItem {
  id: string;
  refTable?: string | null;
  refId?: string | null;
  type:
    | 'call'
    | 'sms'
    | 'viber'
    | 'email'
    | 'offer'
    | 'offer_response'
    | 'appointment'
    | 'appointment_response'
    | 'intake_request'
    | 'intake_submitted'
    | 'upload'
    | 'invoice';
  side: 'us' | 'customer';
  interactive?: boolean;
  title: string;
  body: string | null;
  status?: string | null;
  occurredAt: string;
  payload?: {
    hasBrief?: boolean;
    briefKind?: string;
    startAt?: string | null;
    endAt?: string | null;
    dueDate?: string | null;
    dueTime?: string | null;
    // invoice items (AADE/myDATA add-on)
    mark?: string | null;
    qrUrl?: string | null;
    totalAmount?: number | null;
    invoiceType?: string | null;
  } | null;
}

/** Business profile (GET/PATCH /api/businesses/me — snake_case fields). */
export interface Business {
  id: string;
  name: string | null;
  type?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  vat_number?: string | null;
  tax_office?: string | null;
  default_vat_rate?: number | null;
  default_offer_terms?: string | null;
  default_acceptance_text?: string | null;
  preferred_contact_method?: string | null;
  business_phone_number?: string | null;
  // Structured identity/branding (web parity) — render on the public portal + offer PDF.
  logo_url?: string | null;
  legal_name?: string | null;
  trade_name?: string | null;
  owner_first_name?: string | null;
  owner_last_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  postal_code?: string | null;
  region?: string | null;
  website?: string | null;
  facebook_url?: string | null;
  instagram_url?: string | null;
}

/** Service-catalog item (GET/POST /api/catalog — camelCase in/out). */
export interface CatalogItem {
  id: string;
  code?: string | null;
  name: string;
  unit?: string | null;
  unitPrice: number;
  vatRate: number;
}

/** Customer upload session (read directly from Supabase, like the web panel). */
export interface UploadSession {
  id: string;
  uploaded_at: string;
  files: Array<{ name: string; kind?: string | null; mimeType?: string | null }> | null;
}

/** Flattened gallery entry. */
export interface GalleryFile {
  sessionId: string;
  fileIndex: number;
  name: string;
  kind: 'image' | 'video' | 'file';
}

/** Έργο (work folder) counts (GET /api/customers/[id]/folders). */
export interface WorkFolderCounts {
  offers: number;
  appointments: number;
  messages: number;
  uploadRequests: number;
  intakeRequests: number;
}

/** Έργο (work folder) — a per-job grouping under a customer (WF-1A APIs). */
export interface WorkFolder {
  id: string;
  businessId: string;
  customerId: string;
  title: string;
  status: string; // open | in_progress | done | archived
  step: number; // 0..4 process tracker (Επαφή·Προσφορά·Πληρωμή·Ραντεβού·Τέλος)
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  counts?: WorkFolderCounts;
}

/** Draft/send response of the link endpoints (intake / appointment / offer notify). */
export interface LinkDraft {
  ok?: boolean;
  responseUrl?: string;
  message?: string;
  recipient?: string;
  warning?: string;
  sent?: boolean;
  fallbackReason?: string;
  /** The offer notify route reports its fallback cause as `reason` (link routes use `fallbackReason`). */
  reason?: string;
  error?: string;
}
