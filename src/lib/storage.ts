import type { YorgosMvpState, Customer, Task, Offer, CallRecord, BusinessProfile, CommunicationRecord } from './types';

const STORAGE_KEY = 'yorgos_ai_mvp_state';

export function loadState(): YorgosMvpState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as YorgosMvpState) : {};
  } catch {
    return {};
  }
}

export function saveState(partial: Partial<YorgosMvpState>): void {
  if (typeof window === 'undefined') return;
  try {
    const current = loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...partial }));
  } catch {
    // localStorage unavailable
  }
}

export function clearState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function getCustomers(): Customer[] {
  return loadState().customers ?? [];
}

export function saveCustomers(customers: Customer[]): void {
  saveState({ customers });
}

export function getNextCrmNumber(customers: Customer[]): string {
  const nums = customers
    .map((c) => c.crmNumber)
    .filter(Boolean)
    .map((n) => {
      const match = n!.match(/(\d+)$/);
      return match ? parseInt(match[1]) : 0;
    });
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return `#${max + 1}`;
}

export function ensureCustomerCrmNumbers(customers: Customer[]): Customer[] {
  if (customers.length === 0) return customers;
  const existingNums = customers
    .filter((c) => c.crmNumber)
    .map((c) => {
      const match = c.crmNumber!.match(/(\d+)$/);
      return match ? parseInt(match[1]) : 0;
    });
  let counter = existingNums.length > 0 ? Math.max(...existingNums) : 0;
  return customers.map((c) => {
    if (c.crmNumber) return c;
    counter++;
    return { ...c, crmNumber: `#${counter}` };
  });
}

export function addCustomer(customer: Customer): void {
  const existing = getCustomers();
  const toSave = customer.crmNumber
    ? customer
    : { ...customer, crmNumber: getNextCrmNumber(existing) };
  saveCustomers([...existing, toSave]);
}

export function updateCustomer(updated: Customer): void {
  saveCustomers(getCustomers().map((c) => (c.id === updated.id ? updated : c)));
}

export function deleteCustomer(id: string): void {
  saveCustomers(getCustomers().filter((c) => c.id !== id));
}

export function getTasks(): Task[] {
  return loadState().tasks ?? [];
}

export function saveTasks(tasks: Task[]): void {
  saveState({ tasks });
}

export function addTask(task: Task): void {
  saveTasks([...getTasks(), task]);
}

export function updateTask(updated: Task): void {
  saveTasks(getTasks().map((t) => (t.id === updated.id ? updated : t)));
}

export function deleteTask(id: string): void {
  saveTasks(getTasks().filter((t) => t.id !== id));
}

export function getOffers(): Offer[] {
  return loadState().offers ?? [];
}

export function saveOffers(offers: Offer[]): void {
  saveState({ offers });
}

export function addOffer(offer: Offer): void {
  saveOffers([...getOffers(), offer]);
}

export function updateOffer(updated: Offer): void {
  saveOffers(getOffers().map((o) => (o.id === updated.id ? updated : o)));
}

export function deleteOffer(id: string): void {
  saveOffers(getOffers().filter((o) => o.id !== id));
}

export function addCallRecord(record: CallRecord): void {
  const state = loadState();
  saveState({ calls: [...(state.calls ?? []), record] });
}

export function updateCallRecord(updated: CallRecord): void {
  const state = loadState();
  saveState({ calls: (state.calls ?? []).map((c) => (c.id === updated.id ? updated : c)) });
}

export function getCommunications(): CommunicationRecord[] {
  return loadState().communications ?? [];
}

export function addCommunicationRecord(record: CommunicationRecord): void {
  const state = loadState();
  saveState({ communications: [...(state.communications ?? []), record] });
}

export const SMS_INTAKE_REMINDER_MINUTES = 5;
export const SMS_INTAKE_NO_RESPONSE_MINUTES = 5;

export function advanceSmsIntakeStatuses(customers: Customer[], now = new Date()): Customer[] {
  const nowMs = now.getTime();
  return customers.map((c) => {
    if (
      !c.intakeStatus ||
      c.intakeStatus === 'none' ||
      c.intakeStatus === 'completed' ||
      c.intakeStatus === 'kept_draft'
    ) {
      return c;
    }
    if (c.intakeStatus === 'waiting_sms' && c.intakeSmsSentAt) {
      if (nowMs - new Date(c.intakeSmsSentAt).getTime() >= SMS_INTAKE_REMINDER_MINUTES * 60 * 1000) {
        const ts = now.toISOString();
        return {
          ...c,
          intakeStatus: 'reminder_sent' as const,
          intakeReminderSentAt: ts,
          notes: c.notes
            ? `${c.notes}\nDemo: στάλθηκε δεύτερο SMS υπενθύμισης.`
            : 'Demo: στάλθηκε δεύτερο SMS υπενθύμισης.',
          updatedAt: ts,
        };
      }
    }
    if (c.intakeStatus === 'reminder_sent' && c.intakeReminderSentAt) {
      if (nowMs - new Date(c.intakeReminderSentAt).getTime() >= SMS_INTAKE_NO_RESPONSE_MINUTES * 60 * 1000) {
        const ts = now.toISOString();
        return {
          ...c,
          intakeStatus: 'no_response' as const,
          intakeNoResponseAt: ts,
          notes: c.notes
            ? `${c.notes}\nΟ πελάτης δεν απάντησε στο SMS στοιχείων.`
            : 'Ο πελάτης δεν απάντησε στο SMS στοιχείων.',
          updatedAt: ts,
        };
      }
    }
    return c;
  });
}

export function getBusinessProfile(): BusinessProfile | null {
  return loadState().businessProfile ?? null;
}

export function saveBusinessProfile(profile: BusinessProfile): void {
  saveState({ businessProfile: profile });
}
