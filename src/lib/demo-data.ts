// Demo/mock data — local only, not connected to any real data source or backend.

import type { Customer, Task, Offer, OfferItem } from './types';

export interface DemoMissedCall {
  id: string;
  phoneDisplay: string;
  customerName?: string;
  isUnknown: boolean;
  timeLabel: string;
}

export interface DemoLead {
  id: string;
  name: string;
  phone: string;
  source: string;
  opportunityValue?: number;
  waitingLabel: string;
  waitingDays: number;
}

export type DemoTaskStatus = 'overdue' | 'due_today';
export type DemoPriority = 'low' | 'normal' | 'high';

export interface DemoTask {
  id: string;
  title: string;
  customerName: string;
  typeLabel: string;
  dueLabel: string;
  priority: DemoPriority;
  status: DemoTaskStatus;
}

export type DemoOfferStatus = 'draft' | 'ready_to_send';

export interface DemoOffer {
  id: string;
  offerNumber: string;
  customerName: string;
  total: number;
  status: DemoOfferStatus;
  statusLabel: string;
  validUntilLabel: string;
}

export interface DemoCall {
  id: string;
  nameOrNumber: string;
  direction: 'inbound' | 'outbound';
  durationLabel: string;
  timeLabel: string;
  isMock: true;
}

// ─── Data ────────────────────────────────────────────────────────────────────

export const demoMissedCalls: DemoMissedCall[] = [
  {
    id: 'mc-1',
    phoneDisplay: '+30 693 000 1234',
    isUnknown: true,
    timeLabel: 'πριν 25 λεπτά',
  },
  {
    id: 'mc-2',
    phoneDisplay: '+30 694 555 7890',
    customerName: 'Γ. Καραγιάννης',
    isUnknown: false,
    timeLabel: 'πριν 1 ώρα 30 λεπτά',
  },
];

export const demoLeads: DemoLead[] = [
  {
    id: 'lead-1',
    name: 'Κώστας Αλεξάνδρου',
    phone: '+30 693 777 8888',
    source: 'Google Ads',
    opportunityValue: 2500,
    waitingLabel: '5 μέρες',
    waitingDays: 5,
  },
  {
    id: 'lead-2',
    name: 'Αντώνης Δημητρίου',
    phone: '+30 694 111 2222',
    source: 'Facebook Ads',
    opportunityValue: 1200,
    waitingLabel: '3 μέρες',
    waitingDays: 3,
  },
  {
    id: 'lead-3',
    name: 'Ελένη Παπανικολάου',
    phone: '+30 697 333 4444',
    source: 'Σύσταση',
    opportunityValue: 800,
    waitingLabel: '1 μέρα',
    waitingDays: 1,
  },
];

export const demoTodayTasks: DemoTask[] = [
  {
    id: 'task-1',
    title: 'Κλήση πίσω στον Καραγιάννη',
    customerName: 'Γ. Καραγιάννης',
    typeLabel: 'Κλήση πίσω',
    dueLabel: 'χθες 14:00',
    priority: 'high',
    status: 'overdue',
  },
  {
    id: 'task-2',
    title: 'Αποστολή προσφοράς Δημητρίου',
    customerName: 'Α. Δημητρίου',
    typeLabel: 'Αποστολή προσφοράς',
    dueLabel: 'σήμερα 17:00',
    priority: 'normal',
    status: 'due_today',
  },
  {
    id: 'task-3',
    title: 'Επίσκεψη για αποτύπωση Αλεξάνδρου',
    customerName: 'Κ. Αλεξάνδρου',
    typeLabel: 'Επίσκεψη σε πελάτη',
    dueLabel: 'σήμερα 11:00',
    priority: 'normal',
    status: 'due_today',
  },
];

export const demoOpenOffers: DemoOffer[] = [
  {
    id: 'offer-2',
    offerNumber: '#002',
    customerName: 'Κ. Αλεξάνδρου',
    total: 3100,
    status: 'ready_to_send',
    statusLabel: 'Έτοιμη για αποστολή',
    validUntilLabel: '27 Μαΐ',
  },
  {
    id: 'offer-1',
    offerNumber: '#001',
    customerName: 'Γ. Καραγιάννης',
    total: 1450,
    status: 'draft',
    statusLabel: 'Draft',
    validUntilLabel: '20 Μαΐ',
  },
];

export const demoRecentCalls: DemoCall[] = [
  {
    id: 'call-1',
    nameOrNumber: 'Γ. Καραγιάννης',
    direction: 'inbound',
    durationLabel: '8 λεπτά',
    timeLabel: 'χθες 15:30',
    isMock: true,
  },
  {
    id: 'call-2',
    nameOrNumber: 'Ε. Παπανικολάου',
    direction: 'outbound',
    durationLabel: '12 λεπτά',
    timeLabel: 'προχθές 10:15',
    isMock: true,
  },
  {
    id: 'call-3',
    nameOrNumber: '+30 693 000 5678',
    direction: 'inbound',
    durationLabel: '3 λεπτά',
    timeLabel: 'σήμερα 09:00',
    isMock: true,
  },
];

// Seeded once when state.customers === undefined (first launch only).
// If the user deletes all customers, this array is NOT re-seeded.
export const demoCustomers: Customer[] = [
  {
    id: 'demo-karagiannis',
    name: 'Γιώργης Καραγιάννης',
    companyName: '',
    phone: '+30 694 555 7890',
    email: 'karagiannis@example.gr',
    address: 'Λεωφ. Αλεξάνδρας 45, Αθήνα',
    source: 'inbound_call',
    opportunityValue: 1200,
    status: 'follow_up_needed',
    preferredContactMethod: 'viber',
    needsSummary: '',
    notes: 'Ζήτησε προσφορά για αντικατάσταση HVAC. Να τον καλέσουμε σύντομα.',
    createdAt: '2026-05-10T09:00:00.000Z',
    updatedAt: '2026-05-10T09:00:00.000Z',
    lastContactAt: '2026-05-10T09:00:00.000Z',
    isDemo: true,
  },
  {
    id: 'demo-dimitriou',
    name: 'Αντώνης Δημητρίου',
    companyName: '',
    phone: '+30 694 111 2222',
    email: 'dimitriou@example.gr',
    address: 'Ακτή Μιαούλη 12, Πειραιάς',
    source: 'facebook_ads',
    opportunityValue: 1200,
    status: 'new_lead',
    preferredContactMethod: 'phone',
    needsSummary: '',
    notes: '',
    createdAt: '2026-05-11T10:00:00.000Z',
    updatedAt: '2026-05-11T10:00:00.000Z',
    isDemo: true,
  },
  {
    id: 'demo-papanikolaou',
    name: 'Ελένη Παπανικολάου',
    companyName: '',
    phone: '+30 697 333 4444',
    email: 'papanikolaou@example.gr',
    address: 'Λεωφ. Ποσειδώνος 8, Γλυφάδα',
    source: 'referral',
    opportunityValue: 800,
    status: 'new_lead',
    preferredContactMethod: 'email',
    needsSummary: '',
    notes: '',
    createdAt: '2026-05-12T11:00:00.000Z',
    updatedAt: '2026-05-12T11:00:00.000Z',
    isDemo: true,
  },
  {
    id: 'demo-alexandrou',
    name: 'Κώστας Αλεξάνδρου',
    companyName: 'Αλεξάνδρου Constructions',
    phone: '+30 693 777 8888',
    email: 'alexandrou@example.gr',
    address: 'Κηφισίας 100, Μαρούσι',
    source: 'google_ads',
    opportunityValue: 2500,
    status: 'new_lead',
    preferredContactMethod: 'phone',
    needsSummary: '',
    notes: 'Ενδιαφέρεται για πλήρη ανακαίνιση. Χρειάζεται αποτύπωση χώρου.',
    createdAt: '2026-05-09T08:00:00.000Z',
    updatedAt: '2026-05-09T08:00:00.000Z',
    isDemo: true,
  },
];

// Called once when state.tasks === undefined (first launch only).
// Uses dates relative to today so tasks are always relevant when first seeded.
export function generateDemoTasks(): Task[] {
  const toStr = (d: Date): string => d.toISOString().split('T')[0];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const in3days = new Date(today);
  in3days.setDate(today.getDate() + 3);
  const now = new Date().toISOString();

  return [
    {
      id: 'demo-task-1',
      customerId: 'demo-karagiannis',
      title: 'Κλήση πίσω στον Καραγιάννη',
      type: 'call_back',
      status: 'open',
      priority: 'high',
      dueDate: toStr(yesterday),
      dueTime: '14:00',
      note: 'Ζήτησε να τον καλέσουμε για προσφορά HVAC.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    },
    {
      id: 'demo-task-2',
      customerId: 'demo-dimitriou',
      title: 'Αποστολή προσφοράς Δημητρίου',
      type: 'send_offer',
      status: 'open',
      priority: 'normal',
      dueDate: toStr(today),
      dueTime: '17:00',
      note: '',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    },
    {
      id: 'demo-task-3',
      customerId: 'demo-alexandrou',
      title: 'Επίσκεψη για αποτύπωση χώρου',
      type: 'visit_customer',
      status: 'open',
      priority: 'normal',
      dueDate: toStr(tomorrow),
      dueTime: '10:00',
      note: 'Να φέρω μαζί τον εξοπλισμό μέτρησης.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    },
    {
      id: 'demo-task-4',
      customerId: 'demo-papanikolaou',
      title: 'Follow-up email Παπανικολάου',
      type: 'follow_up_offer',
      status: 'open',
      priority: 'low',
      dueDate: toStr(in3days),
      note: '',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    },
  ];
}

// Called once when state.offers === undefined (first launch only).
export function generateDemoOffers(): Offer[] {
  const toStr = (d: Date): string => d.toISOString().split('T')[0];
  const today = new Date();
  const in30days = new Date(today);
  in30days.setDate(today.getDate() + 30);
  const in10days = new Date(today);
  in10days.setDate(today.getDate() + 10);
  const now = new Date().toISOString();

  const items1: OfferItem[] = [
    { id: 'demo-item-1a', description: 'Εργασία τοποθέτησης HVAC', quantity: 1, unitPrice: 800 },
    { id: 'demo-item-1b', description: 'Υλικά HVAC', quantity: 1, unitPrice: 370 },
  ];
  const subtotal1 = 1170;
  const vatAmount1 = Number((subtotal1 * 24 / 100).toFixed(2));

  const items2: OfferItem[] = [
    { id: 'demo-item-2a', description: 'Εργασία ανακαίνισης', quantity: 1, unitPrice: 2000 },
    { id: 'demo-item-2b', description: 'Υλικά κατασκευής', quantity: 1, unitPrice: 500 },
  ];
  const subtotal2 = 2500;
  const vatAmount2 = Number((subtotal2 * 24 / 100).toFixed(2));

  return [
    {
      id: 'demo-offer-1',
      customerId: 'demo-karagiannis',
      offerNumber: '#001',
      status: 'draft',
      offerDate: toStr(today),
      validUntil: toStr(in30days),
      items: items1,
      subtotal: subtotal1,
      vatRate: 24,
      vatAmount: vatAmount1,
      total: Number((subtotal1 + vatAmount1).toFixed(2)),
      notes: '',
      terms: 'Η παρούσα προσφορά ισχύει για 30 ημέρες από την ημερομηνία έκδοσης.',
      acceptanceText: 'Αποδέχομαι τους παραπάνω όρους και επιθυμώ να προχωρήσουμε.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    },
    {
      id: 'demo-offer-2',
      customerId: 'demo-alexandrou',
      offerNumber: '#002',
      status: 'ready_to_send',
      offerDate: toStr(today),
      validUntil: toStr(in10days),
      items: items2,
      subtotal: subtotal2,
      vatRate: 24,
      vatAmount: vatAmount2,
      total: Number((subtotal2 + vatAmount2).toFixed(2)),
      notes: 'Η τιμή δεν περιλαμβάνει αλλαγές εκτός αντικειμένου.',
      terms: 'Η παρούσα προσφορά ισχύει για 10 ημέρες από την ημερομηνία έκδοσης.',
      acceptanceText: 'Αποδέχομαι τους παραπάνω όρους και επιθυμώ να προχωρήσουμε.',
      createdFromAi: false,
      createdAt: now,
      updatedAt: now,
      isDemo: true,
    },
  ];
}
