// γ — auto-notify the customer when something is added to their project.
//
// Best-effort: NEVER throws, NEVER blocks the create request (always called as a
// fire-and-forget `void notifyFolderUpdate(...).catch(() => {})`). Sends the
// customer their project portal link (the SAME durable link every time, via
// work_folders.portal_url) with a short "Νέο στο έργο «…»: {what}", through their
// preferred channel (Viber→SMS), and logs it to the project thread + portal chat.

import { createServiceSupabaseClient } from './intake-tokens';
import { getOrCreateFolderToken } from './folder-tokens';
import { selectViberPhone } from './viber-phone';
import { normalizeApifonMsisdn } from './apifon-viber';
import { sendViaPreferredChannel } from './send-channel';
import { recordOutboundMessage, extractProviderIds } from './record-message';

const OUTBOUND_SUMMARY = 'Ενημέρωση έργου';

/**
 * The folder's ONE durable customer portal URL — the SAME link the owner shares.
 * getOrCreateFolderToken is the single source of truth (work_folders.portal_url,
 * migration 050): it reuses the canonical link while live, else mints + stores one.
 * Best-effort: returns null on any failure so a notification never breaks the create.
 */
async function ensurePortalUrl(businessId: string, workFolderId: string): Promise<string | null> {
  try {
    const tok = await getOrCreateFolderToken({ businessId, workFolderId });
    return tok.folderUrl;
  } catch {
    return null;
  }
}

export async function notifyFolderUpdate(params: { businessId: string; workFolderId: string; what: string }): Promise<void> {
  const { businessId, workFolderId, what } = params;
  try {
    const supabase = createServiceSupabaseClient();

    const [fRes, bRes] = await Promise.all([
      supabase.from('work_folders').select('title, customer_id').eq('id', workFolderId).eq('business_id', businessId).maybeSingle(),
      supabase.from('businesses').select('name').eq('id', businessId).maybeSingle(),
    ]);
    const folder = (fRes.data as { title: string | null; customer_id: string | null } | null) ?? null;
    if (!folder?.customer_id) return;
    const businessName = (bRes.data as { name?: string | null } | null)?.name ?? null;

    const cRes = await supabase
      .from('customers')
      .select('id, mobile_phone, phone, email, preferred_contact_method')
      .eq('id', folder.customer_id)
      .eq('business_id', businessId)
      .maybeSingle();
    const customer = (cRes.data as { id: string; mobile_phone: string | null; phone: string | null; email: string | null; preferred_contact_method: string | null } | null) ?? null;
    if (!customer) return;

    const phone = selectViberPhone(customer);
    if (!phone || !normalizeApifonMsisdn(phone)) return; // no usable mobile → skip silently

    const portalUrl = await ensurePortalUrl(businessId, workFolderId);
    if (!portalUrl) return;

    const title = folder.title?.trim();
    const text = [
      title ? `Νέο στο έργο «${title}»: ${what}.` : `Νέο στο έργο σας: ${what}.`,
      'Δείτε το εδώ:',
      portalUrl,
      '',
      'Φιλικά,',
      businessName?.trim() || 'η επιχείρηση',
      'μέσω Opiflow',
    ].join('\n');

    const referenceId = `folder-update:${businessId.slice(0, 8)}:${workFolderId.slice(0, 8)}:${Date.now().toString(36)}`;
    const result = await sendViaPreferredChannel({
      preferred: customer.preferred_contact_method ?? null,
      phone,
      text,
      customerId: customer.id,
      referenceId,
    });
    if (!result.ok) return;

    const channel = result.channel === 'sms' ? 'sms' : 'viber';
    const ids = extractProviderIds(result.channel === 'sms' ? result.sms : result.viber);
    await recordOutboundMessage({
      businessId,
      customerId: customer.id,
      channel,
      summary: OUTBOUND_SUMMARY,
      phone,
      referenceId,
      providerRequestId: ids.providerRequestId,
      providerMessageId: ids.providerMessageId,
      workFolderId,
    });
  } catch {
    /* best-effort — a failed notification must never break the create */
  }
}
