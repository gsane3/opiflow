import type { CustomerStatus, OfferStatus, TaskType, TaskPriority, CustomerSource } from './types';

export function getCustomerStatusLabel(status: CustomerStatus): string {
  const labels: Record<CustomerStatus, string> = {
    new_lead: 'Νέο lead',
    contacted: 'Έγινε επικοινωνία',
    follow_up_needed: 'Θέλει follow-up',
    offer_drafted: 'Έχει draft προσφοράς',
    offer_sent: 'Στάλθηκε προσφορά',
    won: 'Κλειστή συμφωνία',
    lost: 'Χαμένη ευκαιρία',
  };
  return labels[status] ?? status;
}

export function getOfferStatusLabel(status: OfferStatus): string {
  const labels: Record<OfferStatus, string> = {
    draft: 'Draft',
    ready_to_send: 'Έτοιμη για αποστολή',
    sent_manually: 'Στάλθηκε',
    accepted: 'Αποδεκτή',
    rejected: 'Απορρίφθηκε',
    expired: 'Έληξε',
  };
  return labels[status] ?? status;
}

export function getTaskTypeLabel(type: TaskType): string {
  const labels: Record<TaskType, string> = {
    call_back: 'Επιστροφή κλήσης',
    send_offer: 'Αποστολή προσφοράς',
    follow_up_offer: 'Follow-up προσφοράς',
    ask_for_photos_documents: 'Ζήτηση εγγράφων',
    book_appointment: 'Κλείσιμο ραντεβού',
    visit_customer: 'Επίσκεψη πελάτη',
    wait_for_reply: 'Αναμονή απάντησης',
    other: 'Άλλο',
  };
  return labels[type] ?? type;
}

export function getTaskPriorityLabel(priority: TaskPriority): string {
  const labels: Record<TaskPriority, string> = {
    high: 'Υψηλή προτεραιότητα',
    normal: 'Κανονική',
    low: 'Χαμηλή',
  };
  return labels[priority] ?? priority;
}

export function getSourceLabel(source: CustomerSource): string {
  const labels: Record<CustomerSource, string> = {
    facebook_ads: 'Facebook διαφήμιση',
    google_ads: 'Google διαφήμιση',
    website_form: 'Φόρμα ιστοσελίδας',
    referral: 'Παραπομπή',
    inbound_call: 'Εισερχόμενη κλήση',
    missed_call: 'Χαμένη κλήση',
    manual_entry: 'Χειροκίνητη εισαγωγή',
    other: 'Άλλο',
  };
  return labels[source] ?? source;
}
