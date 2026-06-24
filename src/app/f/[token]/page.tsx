// Public customer view of a Έργο (work folder) — /f/[token].
// No login. Server-rendered, mobile-first, read-only. The token is validated
// server-side (service-role); an invalid/expired/revoked token shows a neutral
// "link unavailable" message. Only safe, customer-facing data is rendered.

import { cache } from 'react';
import type { Metadata } from 'next';
import { loadPublicFolder, type PublicFolderView } from '@/lib/server/public-folder';
import PortalView from './PortalView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Deduped per request: generateMetadata + the page render share a single load.
const getFolder = cache((token: string) => loadPublicFolder(token));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const view = await getFolder(token).catch(() => null);
  const bizName = view?.business?.name?.trim();
  const title = bizName ? `Το έργο σας · ${bizName}` : 'Το έργο σας';
  const description = bizName
    ? `Προσφορές, ραντεβού και ενημερώσεις από ${bizName}.`
    : 'Προσφορές, ραντεβού και ενημερώσεις.';
  return {
    title,
    description,
    // Tokenized private page: never index, even if the URL is leaked/forwarded.
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website' },
  };
}

function Unavailable() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F5F7] p-6">
      <div className="w-full max-w-md rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-zinc-200/60">
        <p className="text-base font-medium text-zinc-700">Ο σύνδεσμος δεν είναι πλέον διαθέσιμος.</p>
        <p className="mt-2 text-sm text-zinc-500">Επικοινωνήστε μαζί μας αν χρειάζεστε βοήθεια.</p>
      </div>
    </main>
  );
}

export default async function FolderPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view: PublicFolderView | null = await getFolder(token);

  if (!view) return <Unavailable />;

  return <PortalView token={token} view={view} />;
}
