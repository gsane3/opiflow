// Public, customer-facing full offer view ("PDF") for the portal link. The folder
// token in the URL is the only credential; loadPublicOffer re-scopes strictly to
// that token's business + folder and returns only safe, printable offer fields.
import Link from 'next/link';
import { loadPublicOffer } from '@/lib/server/public-offer';
import PublicOfferDoc from './PublicOfferDoc';

export const runtime = 'nodejs';
// Match the portal landing page: never serve a cached (stale) offer total/status.
export const dynamic = 'force-dynamic';

export default async function PublicOfferPage({
  params,
}: {
  params: Promise<{ token: string; offerId: string }>;
}) {
  const { token, offerId } = await params;
  const view = await loadPublicOffer(token, offerId);

  if (!view) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-zinc-500">Η προσφορά δεν είναι διαθέσιμη.</p>
        <Link href={`/f/${encodeURIComponent(token)}`} className="mt-4 text-sm font-semibold text-indigo-600">
          ← Πίσω στο έργο
        </Link>
      </main>
    );
  }

  return <PublicOfferDoc token={token} view={view} />;
}
