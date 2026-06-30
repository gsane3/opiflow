// Invoicing — request validation (Zod) for the routes. Pure → unit-testable.

import { z } from 'zod';
import { isValidGreekVat } from './invoicing.logic';

const optionalVat = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidGreekVat(v), 'invalid_vat')
  .optional();

/** PUT /api/invoicing/settings — owner/admin updates the per-tenant config. */
export const SettingsInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    issuerVat: optionalVat,
    issuerBranch: z.number().int().min(0).optional(),
    invoiceSeries: z.string().trim().max(20).optional(),
    autoIssueOnPayment: z.boolean().optional(),
    defaultIncomeClassification: z.string().trim().max(40).optional(),
  })
  .strict();
export type SettingsInput = z.infer<typeof SettingsInputSchema>;

/** Map the camelCase settings input to the snake_case DB columns (only provided keys). */
export function settingsInputToDb(input: SettingsInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.enabled !== undefined) out.enabled = input.enabled;
  if (input.issuerVat !== undefined) out.issuer_vat = input.issuerVat || null;
  if (input.issuerBranch !== undefined) out.issuer_branch = input.issuerBranch;
  if (input.invoiceSeries !== undefined) out.invoice_series = input.invoiceSeries || null;
  if (input.autoIssueOnPayment !== undefined) out.auto_issue_on_payment = input.autoIssueOnPayment;
  if (input.defaultIncomeClassification !== undefined)
    out.default_income_classification = input.defaultIncomeClassification || null;
  return out;
}

/** POST /api/invoicing/issue — issue from an offer OR an ad-hoc gross amount. */
export const IssueInputSchema = z
  .object({
    offerId: z.string().min(1).optional(),
    amount: z.number().positive().optional(), // GROSS (VAT-inclusive)
    vatRate: z.number().min(0).max(100).optional(),
    description: z.string().trim().min(1).max(300).optional(),
    customerId: z.string().min(1).optional(),
    counterpartyVat: optionalVat,
  })
  .strict()
  .refine((v) => !!v.offerId || (v.amount != null && !!v.description), {
    message: 'offerId_or_amount_required',
  });
export type IssueInput = z.infer<typeof IssueInputSchema>;
