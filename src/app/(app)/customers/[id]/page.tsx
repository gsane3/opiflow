// The customer card now lives at /customers/[id]/chat — the messenger workspace
// with the ➕ composer (message / appointment / offer), the info panel (contact
// details, briefs, files) and AI suggested actions. The old standalone card is
// retired, so this route just redirects to the chat: every «Άνοιγμα πελάτη» link
// and any bookmarked /customers/[id] URL lands on the current view.
import { redirect } from 'next/navigation';

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/customers/${id}/chat`);
}
