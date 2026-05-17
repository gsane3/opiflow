export type CmdIntent =
  | 'query_appointments'
  | 'create_task'
  | 'create_appointment'
  | 'create_offer'
  | 'cancel_appointment'
  | 'unknown';

export interface CmdReviewResult {
  intent: CmdIntent;
  summary: string;
  params: {
    customerName?: string;
    title?: string;
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

const SUPPORTED_INTENTS: CmdIntent[] = [
  'query_appointments',
  'create_task',
  'create_appointment',
  'create_offer',
  'cancel_appointment',
  'unknown',
];

const UNKNOWN_FALLBACK: CmdReviewResult = {
  intent: 'unknown',
  summary: 'Δεν μπόρεσα να καταλάβω την εντολή.',
  params: {},
};

function isValidPriority(v: unknown): v is 'low' | 'normal' | 'high' {
  return v === 'low' || v === 'normal' || v === 'high';
}

function isValidAppointmentType(v: unknown): v is 'book_appointment' | 'visit_customer' {
  return v === 'book_appointment' || v === 'visit_customer';
}

function isValidDateRange(v: unknown): v is 'today' | 'tomorrow' | 'week' | 'all' {
  return v === 'today' || v === 'tomorrow' || v === 'week' || v === 'all';
}

function safeStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function isDateStr(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isTimeStr(v: string): boolean {
  return /^\d{2}:\d{2}$/.test(v);
}

export function parseCmdResponse(raw: string): CmdReviewResult {
  let parsed: unknown;
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\n?/i, '')
      .replace(/\n?```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return UNKNOWN_FALLBACK;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return UNKNOWN_FALLBACK;
  }

  const r = parsed as Record<string, unknown>;

  const intent: CmdIntent = SUPPORTED_INTENTS.includes(r.intent as CmdIntent)
    ? (r.intent as CmdIntent)
    : 'unknown';

  const summary = safeStr(r.summary, 300) || UNKNOWN_FALLBACK.summary;

  const rawParams =
    typeof r.params === 'object' && r.params !== null && !Array.isArray(r.params)
      ? (r.params as Record<string, unknown>)
      : {};

  const params: CmdReviewResult['params'] = {};

  const customerName = safeStr(rawParams.customerName, 150);
  if (customerName) params.customerName = customerName;

  const title = safeStr(rawParams.title, 200);
  if (title) params.title = title;

  const note = safeStr(rawParams.note, 500);
  if (note) params.note = note;

  const rawDate = safeStr(rawParams.dueDate, 10);
  if (isDateStr(rawDate)) params.dueDate = rawDate;

  const rawTime = safeStr(rawParams.dueTime, 5);
  if (isTimeStr(rawTime)) params.dueTime = rawTime;

  if (intent === 'create_task' || intent === 'create_appointment') {
    params.priority = isValidPriority(rawParams.priority) ? rawParams.priority : 'normal';
  }

  if (intent === 'create_appointment') {
    params.appointmentType = isValidAppointmentType(rawParams.appointmentType)
      ? rawParams.appointmentType
      : 'book_appointment';
  }

  if (intent === 'query_appointments') {
    params.dateRange = isValidDateRange(rawParams.dateRange) ? rawParams.dateRange : 'today';
  }

  if (intent === 'cancel_appointment') {
    if (isValidAppointmentType(rawParams.appointmentType)) {
      params.appointmentType = rawParams.appointmentType;
    }
  }

  if (intent === 'create_offer') {
    const rawItems = Array.isArray(rawParams.offerItems) ? rawParams.offerItems : [];
    const offerItems = rawItems
      .slice(0, 8)
      .map((item: unknown) => {
        const i = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
        const description = safeStr(i.description, 200);
        const quantity = typeof i.quantity === 'number' && isFinite(i.quantity) && i.quantity > 0
          ? i.quantity
          : 1;
        const unitPrice = typeof i.unitPrice === 'number' && isFinite(i.unitPrice) && i.unitPrice >= 0
          ? i.unitPrice
          : 0;
        return { description, quantity, unitPrice };
      })
      .filter((i) => i.description.length > 0);
    if (offerItems.length > 0) params.offerItems = offerItems;
    const offerNotes = safeStr(rawParams.offerNotes, 500);
    if (offerNotes) params.offerNotes = offerNotes;
    const offerTerms = safeStr(rawParams.offerTerms, 500);
    if (offerTerms) params.offerTerms = offerTerms;
  }

  return { intent, summary, params };
}
