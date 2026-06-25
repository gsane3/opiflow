// Communications (CRM timeline) — DB row + API DTO types. Mirrors /api/communications.

export const COMMUNICATION_COLUMNS = [
  'id', 'customer_id', 'channel', 'direction', 'status', 'phone', 'summary', 'created_at',
].join(', ');

export const COMMUNICATION_CUSTOMER_COLUMNS = 'id, crm_number, name, company_name, phone, source, status';

export const VALID_CHANNELS = ['call', 'sms', 'viber', 'email'] as const;
export const VALID_DIRECTIONS = ['inbound', 'outbound'] as const;
export const VALID_POST_STATUSES = ['completed', 'failed'] as const;

export interface CommunicationRow {
  id: string;
  customer_id: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  created_at: string;
}

export interface CommunicationCustomerRow {
  id: string;
  crm_number: string | null;
  name: string | null;
  company_name: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
}

export interface CommunicationCustomer {
  id: string;
  crmNumber: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  source: string | null;
  status: string | null;
}

export interface Communication {
  id: string;
  customerId: string | null;
  channel: string;
  direction: string;
  status: string;
  phone: string | null;
  summary: string | null;
  createdAt: string;
  customer: CommunicationCustomer | null;
}
