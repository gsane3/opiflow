import type { NextRequest } from 'next/server';
import { requireBusinessUser, assertManager } from '@/server/core/http';
import { ok, handleApiError, AppError } from '@/server/core/errors';
import { isInvoicingConfigured } from '@/server/modules/invoicing/invoicing.config';
import { getInvoicingSettings, getInvoicingAddonStatus, upsertInvoicingSettings } from '@/server/modules/invoicing/invoicing.repo';
import { isInvoicingAddonConfigured } from '@/server/modules/invoicing/invoicing-addon.service';
import { SettingsInputSchema, settingsInputToDb } from '@/server/modules/invoicing/invoicing.schema';

export const runtime = 'nodejs';

// GET — read the per-tenant invoicing settings + whether the provider/add-on are
// configured + the tenant's add-on entitlement (tolerant of a pre-068 schema).
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireBusinessUser(request);
    const settings = await getInvoicingSettings(ctx);
    const addon = await getInvoicingAddonStatus(ctx); // undefined → pre-068; UI treats as 'none'
    return ok({
      settings,
      configured: isInvoicingConfigured(),
      addonConfigured: isInvoicingAddonConfigured(),
      addon: addon ?? null,
    });
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
    // Server-side add-on gate: once the paid add-on is configured (Stripe price
    // env set), ENABLING invoicing requires an active add-on subscription — the
    // wizard already enforces this in the UI, but the API must too. Deploys
    // without the env (and pre-068 schemas) are unaffected.
    if (input.enabled === true && isInvoicingAddonConfigured()) {
      const addon = await getInvoicingAddonStatus(ctx);
      if (addon !== undefined && addon.addon_status !== 'active') {
        throw new AppError('invoicing_addon_required', 402);
      }
    }
    const settings = await upsertInvoicingSettings(ctx, settingsInputToDb(input));
    return ok({ settings });
  } catch (err) {
    return handleApiError(err);
  }
}
