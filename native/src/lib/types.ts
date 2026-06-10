// Shared API types — mirror the web app's /api/* response shapes (camelCase).

export interface Customer {
  id: string;
  crmNumber?: string | null;
  name: string | null;
  companyName?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  landlinePhone?: string | null;
  email?: string | null;
  address?: string | null;
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
    | 'upload';
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
  } | null;
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
  error?: string;
}
