import {
  createServiceSupabaseClient,
  findValidUploadToken,
  markUploadTokenOpened,
} from '@/lib/server/upload-tokens';
import UploadClient from './UploadClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getTokenState(token: string): Promise<{
  valid: boolean;
  reason: 'expired' | 'invalid' | null;
}> {
  try {
    const supabase = createServiceSupabaseClient();
    const tokenRow = await findValidUploadToken(token);

    if (!tokenRow) {
      // Distinguish completed/revoked from never-existed/expired by checking DB directly.
      const tokenHash = (await import('@/lib/server/upload-tokens')).hashUploadToken(token);
      const { data } = await supabase
        .from('customer_upload_tokens')
        .select('status')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      if (data && (data as { status: string }).status === 'completed') {
        return { valid: false, reason: 'expired' };
      }

      return { valid: false, reason: 'invalid' };
    }

    // Mark opened best-effort -- do not fail the page if this errors.
    try {
      await markUploadTokenOpened(tokenRow.id);
    } catch {
      // intentionally swallowed
    }

    return { valid: true, reason: null };
  } catch {
    return { valid: false, reason: 'invalid' };
  }
}

export default async function UploadPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const state = await getTokenState(token);

  return <UploadClient valid={state.valid} reason={state.reason} />;
}
