import type { NextRequest } from 'next/server';
import { requireBusinessUser, assertManager } from '@/server/core/http';
import { ok, handleApiError } from '@/server/core/errors';
import { isInvoicingConfigured } from '@/server/modules/invoicing/invoicing.config';
import { getInvoicingSettings, upsertInvoicingSettings } from '@/server/modules/invoicing/invoicing.repo';
import { SettingsInputSchema, settingsInputToDb } from '@/server/modules/invoicing/invoicing.schema';

export const runtime = 'nodejs';

// GET — read the per-tenant invoicing settings + whether the provider is configured.
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireBusinessUser(request);
    const settings = await getInvoicingSettings(ctx);
    return ok({ settings, configured: isInvoicingConfigured() });
  } catch (err) {
    return handleApiError(err);
  }
}

// PUT — owner/admin updates the settings (enable, issuer ΑΦΜ, series, auto-issue…).
export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireBusinessUser(request);
    assertManager(ctx);
    const input = SettingsInputSchema.parse(await request.json());
    const settings = await upsertInvoicingSettings(ctx, settingsInputToDb(input));
    return ok({ settings });
  } catch (err) {
    return handleApiError(err);
  }
}
