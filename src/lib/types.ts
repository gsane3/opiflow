export type BusinessType =
  | 'technical_services'
  | 'sales_services'
  | 'projects_construction'
  | 'other';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  onboardingCompleted: boolean;
}

export interface BusinessProfile {
  id: string;
  businessName: string;
  businessType: BusinessType;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  vatNumber: string;
  taxOffice: string;
  logoDataUrl: string;
  defaultVatRate: number;
  defaultOfferTerms: string;
  defaultAcceptanceText: string;
  preferredContactMethod: 'viber' | 'email' | 'phone';
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  mode: 'mock_local';
}

export type CustomerStatus =
  | 'new_lead'
  | 'contacted'
  | 'follow_up_needed'
  | 'offer_drafted'
  | 'offer_sent'
  | 'won'
  | 'lost';

export type CustomerSource =
  | 'facebook_ads'
  | 'google_ads'
  | 'website_form'
  | 'referral'
  | 'inbound_call'
  | 'missed_call'
  | 'manual_entry'
  | 'other';

export type PreferredContactMethod = 'viber' | 'email' | 'phone';

export interface Customer {
  id: string;
  name: string;
  companyName: string;
  phone: string;
  email: string;
  address: string;
  source: CustomerSource;
  opportunityValue?: number;
  status: CustomerStatus;
  preferredContactMethod: PreferredContactMethod;
  needsSummary: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string;
  nextTaskId?: string;
  crmNumber?: string;
  mobilePhone?: string;
  landlinePhone?: string;
  intakeStatus?: 'none' | 'waiting_sms' | 'reminder_sent' | 'no_response' | 'completed' | 'kept_draft';
  intakeSmsSentAt?: string;
  intakeReminderSentAt?: string;
  intakeNoResponseAt?: string;
  isDemo?: boolean;
}

export type TaskType =
  | 'call_back'
  | 'send_offer'
  | 'follow_up_offer'
  | 'ask_for_photos_documents'
  | 'book_appointment'
  | 'visit_customer'
  | 'wait_for_reply'
  | 'other';

export type TaskPriority = 'low' | 'normal' | 'high';

export type TaskBaseStatus = 'open' | 'completed' | 'cancelled';

export type TaskEffectiveStatus = 'overdue' | 'due_today' | 'upcoming' | 'completed' | 'cancelled';

export interface Task {
  id: string;
  customerId?: string;
  title: string;
  type: TaskType;
  status: TaskBaseStatus;
  priority: TaskPriority;
  dueDate: string; // YYYY-MM-DD
  dueTime?: string; // HH:mm
  note: string;
  offerId?: string; // optional link to a specific offer (e.g. for follow_up_offer tasks)
  createdFromAi: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  isDemo?: boolean;
}

export function getEffectiveStatus(task: Task): TaskEffectiveStatus {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'cancelled') return 'cancelled';
  const todayStr = new Date().toISOString().split('T')[0];
  if (task.dueDate < todayStr) return 'overdue';
  if (task.dueDate === todayStr) return 'due_today';
  return 'upcoming';
}

export type OfferStatus =
  | 'draft'
  | 'ready_to_send'
  | 'sent_manually'
  | 'accepted'
  | 'rejected'
  | 'expired';

export interface OfferItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Offer {
  id: string;
  customerId?: string;
  relatedTaskId?: string;
  offerNumber: string;
  status: OfferStatus;
  offerDate: string; // YYYY-MM-DD
  validUntil: string; // YYYY-MM-DD
  items: OfferItem[];
  subtotal: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  notes: string;
  terms: string;
  acceptanceText: string;
  createdFromAi: boolean;
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}

export interface YorgosMvpState {
  userProfile?: UserProfile;
  businessProfile?: BusinessProfile;
  workspace?: Workspace;
  customers?: Customer[];
  tasks?: Task[];
  offers?: Offer[];
  calls?: CallRecord[];
}

export type CallType =
  | 'inbound_new_customer'
  | 'inbound_existing_customer'
  | 'outbound_new_lead'
  | 'outbound_existing_customer';

export type CallDirection = 'inbound' | 'outbound';

export interface CallRecord {
  id: string;
  customerId?: string;
  callType: CallType;
  direction: CallDirection;
  status: 'completed' | 'missed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  durationSeconds: number;
  isMock: true;
  demoScenarioId?: string;
  summary?: string;
  nextStep?: string;
  createdAt: string;
}
