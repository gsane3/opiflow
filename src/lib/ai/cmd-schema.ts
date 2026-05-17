export type CmdIntent =
  | 'query_appointments'
  | 'create_task'
  | 'create_appointment'
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
  };
}

const SUPPORTED_INTENTS: CmdIntent[] = [
  'query_appointments',
  'create_task',
  'create_appointment',
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

  return { intent, summary, params };
}
