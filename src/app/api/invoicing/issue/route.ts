import type { NextRequest } from 'next/server';
import { requireBusinessUser, assertManager } from '@/server/core/http';
import { ok, fail, handleApiError } from '@/server/core/errors';
import { isInvoicingConfigured } from '@/server/modules/invoicing/invoicing.config';
import { issueForOffer, issueManualGross } from '@/server/modules/invoicing/invoicing.service';
import { IssueInputSchema } from '@/server/modules/invoicing/invoicing.schema';

export const runtime = 'nodejs';

// POST — issue an official myDATA document, from an offer OR an ad-hoc gross amount.
// Owner/admin only; 503 while the provider (SBZ) env is unset.
export async function POST(request: NextRequest) {
  if (!isInvoicingConfigured()) return fail('invoicing_not_configured', 503);
  try {
    const ctx = await requireBusinessUser(request);
    assertManager(ctx);
    const body = IssueInputSchema.parse(await request.json());

    const invoice = body.offerId
      ? await issueForOffer(ctx, body.offerId)
      : await issueManualGross(ctx, {
          gross: body.amount as number,
          vatRate: body.vatRate ?? 24,
          description: body.description as string,
          customerId: body.customerId ?? null,
          counterpartyVat: body.counterpartyVat ?? null,
        });

    return ok({ invoice });
  } catch (err) {
    return handleApiError(err);
  }
}
