// Offers — Zod input validation (reference module). Parity-matched to /api/offers.
// Line items themselves are parsed by the existing pure helper parseOfferItems()
// (reused verbatim in the service), so this schema validates the scalar fields.

import { z } from 'zod';

export const OFFER_STATUSES = [
  'draft', 'ready_to_send', 'sent_manually', 'accepted', 'rejected', 'expired',
] as const;

export const CreateOfferScalarsSchema = z.object({
  status: z.enum(OFFER_STATUSES).optional(),
  vatRate: z.number().min(0).max(100).optional(),
  // Dates are kept lenient (plain non-empty strings) for parity with the route's
  // str()-based handling; the service maps absent/empty to today/null.
  offerDate: z.string().min(1).optional(),
  validUntil: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  relatedTaskId: z.string().min(1).optional(),
  relatedCallId: z.string().min(1).optional(),
  offerNumber: z.string().min(1).optional(),
  notes: z.string().trim().min(1).optional(),
  terms: z.string().trim().min(1).optional(),
  acceptanceText: z.string().trim().min(1).optional(),
  viberDraft: z.string().trim().min(1).optional(),
  emailSubject: z.string().trim().min(1).optional(),
  emailBody: z.string().trim().min(1).optional(),
  createdFromAi: z.boolean().optional(),
});

export type CreateOfferScalars = z.infer<typeof CreateOfferScalarsSchema>;

export const ListOffersQuerySchema = z.object({
  status: z.enum(OFFER_STATUSES).optional(),
  customerId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ListOffersQuery = z.infer<typeof ListOffersQuerySchema>;
