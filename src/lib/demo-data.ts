// Demo/mock data — local only, not connected to any real data source or backend.

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
