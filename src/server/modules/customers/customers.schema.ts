// Customers — Zod input validation (reference module, PR-1).
//
// Replaces the live route's hand-rolled enum/`str()` checks with declarative
// schemas. Kept deliberately PARITY-equivalent to the current route so adopting it
// rejects exactly what the route rejects today and accepts exactly what it accepts
// (e.g. email is NOT format-checked, matching the current `str()` behaviour — a
// stricter rule would be a behaviour change, deferred to a later PR).

import { z } from 'zod';

export const CUSTOMER_STATUSES = ['new', 'in_progress', 'won', 'lost'] as const;

export const CUSTOMER_SOURCES = [
  'facebook_ads', 'google_ads', 'website_form', 'referral',
  'inbound_call', 'missed_call', 'manual_entry', 'other',
] as const;

export const CONTACT_METHODS = ['viber', 'sms', 'email', 'phone'] as const;

export const INTAKE_STATUSES = [
  'none', 'pending', 'sent', 'opened', 'submitted', 'expired', 'revoked',
] as const;

const text = (max: number) => z.string().trim().min(1).max(max);

export const CreateCustomerSchema = z
  .object({
    name: text(200).optional(),
    companyName: text(200).optional(),
    phone: text(40).optional(),
    mobilePhone: text(40).optional(),
    landlinePhone: text(40).optional(),
    // Lenient on purpose — parity with the current route (no email-format check).
    email: text(200).optional(),
    address: text(500).optional(),
    source: z.enum(CUSTOMER_SOURCES).optional(),
    status: z.enum(CUSTOMER_STATUSES).optional(),
    opportunityValue: z.number().finite().nonnegative().optional(),
    needsSummary: text(2000).optional(),
    notes: text(5000).optional(),
    preferredContactMethod: z.enum(CONTACT_METHODS).optional(),
    intakeStatus: z.enum(INTAKE_STATUSES).optional(),
    importedFromPhone: z.boolean().optional(),
  })
  .refine(
    (v) => Boolean(v.name || v.companyName || v.phone || v.mobilePhone || v.email),
    { message: 'at_least_one_identifier_required' },
  );

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

export const ListCustomersQuerySchema = z.object({
  status: z.enum(CUSTOMER_STATUSES).optional(),
  q: z.string().trim().optional(),
  awaiting: z.boolean().optional().default(false),
  sort: z.enum(['name', 'recency']).default('recency'),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;
