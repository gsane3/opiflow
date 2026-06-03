import type { DeskopMvpState } from './types';
import { calculateTotals } from './offer-calculations';

export interface DataHealthIssue {
  entity: string;
  message: string;
}

export interface DataHealthReport {
  counts: {
    customers: number;
    tasks: number;
    offers: number;
    calls: number;
    communications: number;
  };
  issues: DataHealthIssue[];
  healthy: boolean;
}

export function buildDataHealthReport(state: DeskopMvpState): DataHealthReport {
  const customers = state.customers ?? [];
  const tasks = state.tasks ?? [];
  const offers = state.offers ?? [];
  const calls = state.calls ?? [];
  const communications = state.communications ?? [];

  const customerIds = new Set(customers.map((c) => c.id));
  const issues: DataHealthIssue[] = [];

  // Customers: missing name
  for (const c of customers) {
    if (!c.name?.trim()) {
      issues.push({ entity: 'Πελάτης', message: `ID ${c.id.slice(0, 8)}: λείπει το όνομα` });
    }
  }

  // Customers: missing phone and email
  for (const c of customers) {
    const hasContact =
      c.phone?.trim() || c.mobilePhone?.trim() || c.landlinePhone?.trim() || c.email?.trim();
    if (!hasContact) {
      const label = c.name?.trim() || c.id.slice(0, 8);
      issues.push({ entity: 'Πελάτης', message: `"${label}": δεν υπάρχει τηλέφωνο ή email` });
    }
  }

  // Duplicate CRM numbers
  const crmNums = new Map<string, number>();
  for (const c of customers) {
    if (c.crmNumber) {
      crmNums.set(c.crmNumber, (crmNums.get(c.crmNumber) ?? 0) + 1);
    }
  }
  for (const [num, count] of crmNums.entries()) {
    if (count > 1) {
      issues.push({ entity: 'Πελάτης', message: `Αρ. ${num}: διπλότυπο crmNumber (${count} καρτέλες)` });
    }
  }

  // Tasks: missing customerId
  for (const t of tasks) {
    if (!t.customerId) {
      issues.push({ entity: 'Task', message: `"${t.title}": δεν συνδέεται με πελάτη` });
    } else if (!customerIds.has(t.customerId)) {
      issues.push({ entity: 'Task', message: `"${t.title}": ο πελάτης (${t.customerId.slice(0, 8)}) δεν βρέθηκε` });
    }
  }

  // Offers: missing customerId or non-existing customer
  for (const o of offers) {
    if (!o.customerId) {
      issues.push({ entity: 'Προσφορά', message: `${o.offerNumber}: δεν συνδέεται με πελάτη` });
    } else if (!customerIds.has(o.customerId)) {
      issues.push({ entity: 'Προσφορά', message: `${o.offerNumber}: ο πελάτης (${o.customerId.slice(0, 8)}) δεν βρέθηκε` });
    }
  }

  // Offers: total mismatch
  for (const o of offers) {
    if (!o.items?.length) continue;
    const computed = calculateTotals(o.items, o.vatRate ?? 0);
    const storedTotal = Number((o.total ?? 0).toFixed(2));
    if (computed.total !== storedTotal) {
      issues.push({
        entity: 'Προσφορά',
        message: `${o.offerNumber}: αποθηκευμένο σύνολο ${storedTotal} != υπολογισμένο ${computed.total}`,
      });
    }
  }

  // Calls: customerId exists but customer not found
  for (const c of calls) {
    if (c.customerId && !customerIds.has(c.customerId)) {
      issues.push({ entity: 'Κλήση', message: `ID ${c.id.slice(0, 8)}: ο πελάτης (${c.customerId.slice(0, 8)}) δεν βρέθηκε` });
    }
  }

  // Communications: customerId exists but customer not found
  for (const cm of communications) {
    if (cm.customerId && !customerIds.has(cm.customerId)) {
      issues.push({ entity: 'Επικοινωνία', message: `ID ${cm.id.slice(0, 8)}: ο πελάτης (${cm.customerId.slice(0, 8)}) δεν βρέθηκε` });
    }
  }

  return {
    counts: {
      customers: customers.length,
      tasks: tasks.length,
      offers: offers.length,
      calls: calls.length,
      communications: communications.length,
    },
    issues,
    healthy: issues.length === 0,
  };
}
