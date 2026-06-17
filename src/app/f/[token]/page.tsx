// Public customer view of a Έργο (work folder) — /f/[token].
// No login. Server-rendered, mobile-first, read-only. The token is validated
// server-side (service-role); an invalid/expired/revoked token shows a neutral
// "link unavailable" message. Only safe, customer-facing data is rendered.

import { loadPublicFolder, type PublicFolderView } from '@/lib/server/public-folder';
import PortalView from './PortalView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const view: PublicFolderView | null = await loadPublicFolder(token);

  if (!view) return <Unavailable />;

  return <PortalView token={token} view={view} />;
}
