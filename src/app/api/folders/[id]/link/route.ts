// POST /api/folders/[id]/link — business sends/copies the public folder link.
//
//   mode='draft' (default): rotate pending tokens, create a fresh token, return
//     the /f/[token] URL + a preview message + recipient (for copy/review).
//   mode='send': verify the reviewed responseUrl's token (scoped to this folder
//     + business; must be live) — or create a fresh one — then dispatch via the
//     customer's preferred channel (Viber→SMS) or email, log the outbound
//     message, and mark the token sent.
//
// Reuses the existing send stack (send-channel / record-message / customer-email
// / viber-phone) — no new providers. Authenticated business route; the token
// never carries business auth. Requires migration 046 (customer_folder_tokens).

import { NextRequest, NextResponse } from 'next/server';
import { authenticateBusinessRequest } from '@/lib/api/auth';
import { selectViberPhone } from '@/lib/server/viber-phone';
import { normalizeApifonMsisdn } from '@/lib/server/apifon-viber';
import { sendViaPreferredChannel } from '@/lib/server/send-channel';
import { sendCustomerLinkEmail } from '@/lib/server/customer-email';
import { recordOutboundMessage, extractProviderIds } from '@/lib/server/record-message';
import {
  buildFolderUrl,
  extractRawTokenFromFolderUrl,
  getOrCreateFolderToken,
  hashFolderToken,
  markFolderTokenSent,
} from '@/lib/server/folder-tokens';

export const runtime = 'nodejs';

function str(val: unknown): string | null {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const VALID_MODES = ['draft', 'send', 'open'] as const;
type LinkMode = (typeof VALID_MODES)[number];

const OUTBOUND_SUMMARY = 'Σύνδεσμος έργου';

function buildFolderMessage(folderUrl: string, businessName: string | null, folderTitle: string | null): string {
  const name = businessName?.trim() || 'την επιχείρηση';
  const title = folderTitle?.trim();
  return [
    title
      ? `Καλησπέρα σας. Μπορείτε να δείτε το έργο «${title}» στον παρακάτω σύνδεσμο:`
      : 'Καλησπέρα σας. Μπορείτε να δείτε το έργο σας στον παρακάτω σύνδεσμο:',
    folderUrl,
    '',
    'Φιλικά,',
    name,
    'μέσω Opiflow Assistant',
  ].join('\n');
}

interface FolderRow {
  id: string;
  customer_id: string;
  title: string | null;
}
interface CustomerRow {
  id: string;
  mobile_phone: string | null;
  phone: string | null;
  email: string | null;
  preferred_contact_method: string | null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: 'unsupported_content_type' }, { status: 415 });
  }

  const auth = await authenticateBusinessRequest(request);
  if ('error' in auth) return auth.error;
  const { supabase, businessId } = auth.ctx;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;

    let mode: LinkMode = 'draft';
    if (raw.mode != null) {
      const m = str(raw.mode);
      if (!m || !(VALID_MODES as readonly string[]).includes(m)) {
        return NextResponse.json({ ok: false, error: 'invalid_mode' }, { status: 400 });
      }
      mode = m as LinkMode;
    }

    const { id: folderId } = await params;

    // Folder must belong to this business.
    const { data: folderData, error: folderErr } = await supabase
      .from('work_folders')
      .select('id, customer_id, title')
      .eq('id', folderId)
      .eq('business_id', businessId)
      .maybeSingle();
    if (folderErr) {
      return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
    }
    if (!folderData) {
      return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    }
    const folder = folderData as unknown as FolderRow;

    // Business name (for the message) + customer (recipient), both business-scoped.
    const [bizRes, custRes] = await Promise.all([
      supabase.from('businesses').select('name, email').eq('id', businessId).maybeSingle(),
      supabase
        .from('customers')
        .select('id, mobile_phone, phone, email, preferred_contact_method')
        .eq('id', folder.customer_id)
        .eq('business_id', businessId)
        .maybeSingle(),
    ]);
    const businessName = (bizRes.data as { name?: string | null } | null)?.name ?? null;
    const businessEmail = (bizRes.data as { email?: string | null } | null)?.email ?? null;
    const customer = (custRes.data as unknown as CustomerRow | null) ?? null;
    if (!customer) {
      return NextResponse.json({ ok: false, error: 'customer_not_found' }, { status: 404 });
    }

    const now = new Date().toISOString();

    // -------------------------------------------------------------------------
    // Open / Draft: return the folder's DURABLE link. Reuses the existing live
    // token (same /f/<token> URL every time) or creates one — never revokes, so a
    // link already delivered to the customer keeps working. One stable link per Έργο.
    // -------------------------------------------------------------------------
    if (mode === 'open' || mode === 'draft') {
      try {
        const tok = await getOrCreateFolderToken({ businessId, workFolderId: folderId });
        return NextResponse.json({
          ok: true,
          mode,
          sent: false,
          responseUrl: tok.folderUrl,
          message: buildFolderMessage(tok.folderUrl, businessName, folder.title),
          recipient: selectViberPhone(customer),
          fallbackReason: null,
        });
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
    }

    // -------------------------------------------------------------------------
    // Send.
    // -------------------------------------------------------------------------
    const reviewedUrl = str(raw.responseUrl);
    let folderUrl: string;
    let verifiedTokenId: string | null = null;

    if (reviewedUrl) {
      const rawToken = extractRawTokenFromFolderUrl(reviewedUrl);
      if (!rawToken) {
        return NextResponse.json({ ok: false, error: 'invalid_link' }, { status: 400 });
      }
      const tokenHash = hashFolderToken(rawToken);
      const { data: tok, error: tokErr } = await supabase
        .from('customer_folder_tokens')
        .select('id')
        .eq('token_hash', tokenHash)
        .eq('work_folder_id', folderId)
        .eq('business_id', businessId)
        .in('status', ['pending', 'sent', 'opened'])
        .gt('expires_at', now)
        .is('revoked_at', null)
        .maybeSingle();
      if (tokErr) {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
      if (!tok) {
        return NextResponse.json({ ok: false, error: 'link_expired' }, { status: 422 });
      }
      verifiedTokenId = (tok as { id: string }).id;
      folderUrl = buildFolderUrl(rawToken);
    } else {
      try {
        // Durable link: reuse the folder's live token (or create one) — no revoke.
        const tok = await getOrCreateFolderToken({ businessId, workFolderId: folderId, sentChannel: 'viber' });
        folderUrl = tok.folderUrl;
        verifiedTokenId = tok.row.id; // so the post-dispatch markFolderTokenSent records the channel
      } catch {
        return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
      }
    }

    const messageText = buildFolderMessage(folderUrl, businessName, folder.title);

    // Email channel.
    if (str(raw.channel) === 'email') {
      const email = str(customer.email);
      if (!email) {
        return NextResponse.json({ ok: true, sent: false, fallbackReason: 'missing_email' });
      }
      const emailResult = await sendCustomerLinkEmail({
        to: email,
        subject: 'Έργο',
        text: messageText,
        businessName,
        businessEmail,
      });
      if (!emailResult.ok) {
        const fallbackReason =
          emailResult.reason === 'missing_email_config' ? 'provider_unavailable' : 'provider_failed';
        return NextResponse.json({ ok: true, sent: false, fallbackReason });
      }
      await recordOutboundMessage({ businessId, customerId: folder.customer_id, channel: 'email', summary: OUTBOUND_SUMMARY });
      if (verifiedTokenId) {
        try {
          await markFolderTokenSent({ tokenId: verifiedTokenId, sentChannel: 'email', sentToPhone: null });
        } catch {
          // intentionally swallowed: the email was already sent
        }
      }
      return NextResponse.json({ ok: true, sent: true, fallbackReason: null });
    }

    // Viber → SMS.
    const rawPhone = selectViberPhone(customer);
    if (!rawPhone || !normalizeApifonMsisdn(rawPhone)) {
      return NextResponse.json({ ok: true, sent: false, fallbackReason: 'missing_mobile' });
    }

    const referenceId = `folder-link:${businessId.slice(0, 8)}:${(verifiedTokenId ?? folderId).slice(0, 8)}`;
    const result = await sendViaPreferredChannel({
      preferred: customer.preferred_contact_method ?? null,
      phone: rawPhone,
      text: messageText,
      customerId: folder.customer_id,
      referenceId,
    });

    if (!result.ok) {
      const fallbackReason =
        result.reason === 'missing_apifon_config' ? 'provider_unavailable' : 'provider_failed';
      return NextResponse.json({ ok: true, sent: false, fallbackReason });
    }

    {
      const ids = extractProviderIds(result.channel === 'sms' ? result.sms : result.viber);
      await recordOutboundMessage({
        businessId,
        customerId: folder.customer_id,
        channel: result.channel === 'sms' ? 'sms' : 'viber',
        summary: OUTBOUND_SUMMARY,
        phone: rawPhone,
        referenceId,
        providerRequestId: ids.providerRequestId,
        providerMessageId: ids.providerMessageId,
      });
    }

    if (verifiedTokenId) {
      try {
        await markFolderTokenSent({
          tokenId: verifiedTokenId,
          sentChannel: result.channel === 'sms' ? 'sms' : 'viber',
          sentToPhone: rawPhone,
        });
      } catch {
        // intentionally swallowed
      }
    }

    return NextResponse.json({ ok: true, sent: true, fallbackReason: null });
  } catch {
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
