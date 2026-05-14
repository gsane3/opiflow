import type {
  CustomerSource,
  PreferredContactMethod,
  CustomerStatus,
  TaskType,
  TaskPriority,
} from '../types';

const VALID_SOURCES: CustomerSource[] = [
  'facebook_ads', 'google_ads', 'website_form', 'referral',
  'inbound_call', 'missed_call', 'manual_entry', 'other',
];
const VALID_CONTACTS: PreferredContactMethod[] = ['viber', 'email', 'phone'];
const VALID_STATUSES: CustomerStatus[] = [
  'new_lead', 'contacted', 'follow_up_needed', 'offer_drafted',
  'offer_sent', 'won', 'lost',
];
const VALID_TASK_TYPES: TaskType[] = [
  'call_back', 'send_offer', 'follow_up_offer', 'ask_for_photos_documents',
  'book_appointment', 'visit_customer', 'wait_for_reply', 'other',
];
const VALID_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high'];

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function pick<T>(v: unknown, valid: T[], fallback: T): T {
  return valid.includes(v as T) ? (v as T) : fallback;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export interface AiReviewResult {
  customer: {
    name: string;
    phone: string;
    email: string;
    source: CustomerSource;
    opportunityValue: number;
    preferredContactMethod: PreferredContactMethod;
  };
  summary: string;
  customerNeeds: string;
  tasks: Array<{
    title: string;
    type: TaskType;
    dueDate: string;
    dueTime: string;
    priority: TaskPriority;
    note: string;
  }>;
  offer: {
    shouldCreate: boolean;
    items: Array<{ description: string; quantity: number; unitPrice: number }>;
    notes: string;
    terms: string;
  };
  statusUpdate: CustomerStatus;
  nextBestAction: string;
  warnings: string[];
}

export function parseAiResponse(raw: unknown): AiReviewResult {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const c = (typeof r.customer === 'object' && r.customer !== null ? r.customer : {}) as Record<string, unknown>;

  const rawTasks = Array.isArray(r.tasks) ? r.tasks : [];
  const tasks = rawTasks
    .slice(0, 5)
    .map((t: unknown) => {
      const task = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
      const dueDate = str(task.dueDate);
      return {
        title: str(task.title),
        type: pick(task.type, VALID_TASK_TYPES, 'other' as TaskType),
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : tomorrowStr(),
        dueTime: str(task.dueTime),
        priority: pick(task.priority, VALID_PRIORITIES, 'normal' as TaskPriority),
        note: str(task.note),
      };
    })
    .filter((t) => t.title.trim().length > 0);

  const o = (typeof r.offer === 'object' && r.offer !== null ? r.offer : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(o.items) ? o.items : [];
  const offerItems = rawItems
    .slice(0, 10)
    .map((i: unknown) => {
      const item = (typeof i === 'object' && i !== null ? i : {}) as Record<string, unknown>;
      return {
        description: str(item.description),
        quantity: Math.max(0.5, num(item.quantity, 1)),
        unitPrice: Math.max(0, num(item.unitPrice, 0)),
      };
    })
    .filter((i) => i.description.trim().length > 0);

  const rawWarnings = Array.isArray(r.warnings) ? r.warnings : [];

  return {
    customer: {
      name: str(c.name),
      phone: str(c.phone),
      email: str(c.email),
      source: pick(c.source, VALID_SOURCES, 'inbound_call' as CustomerSource),
      opportunityValue: Math.max(0, num(c.opportunityValue, 0)),
      preferredContactMethod: pick(c.preferredContactMethod, VALID_CONTACTS, 'phone' as PreferredContactMethod),
    },
    summary: str(r.summary),
    customerNeeds: str(r.customerNeeds),
    tasks,
    offer: {
      shouldCreate: typeof o.shouldCreate === 'boolean' ? o.shouldCreate : offerItems.length > 0,
      items: offerItems,
      notes: str(o.notes),
      terms: str(o.terms),
    },
    statusUpdate: pick(r.statusUpdate, VALID_STATUSES, 'contacted' as CustomerStatus),
    nextBestAction: str(r.nextBestAction),
    warnings: rawWarnings.filter((w): w is string => typeof w === 'string').slice(0, 5),
  };
}
