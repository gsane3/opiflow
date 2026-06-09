// Messenger-style customer chat — preview route (redesign P3b).
// Renders the new MessengerTimeline (reads /api/customers/[id]/timeline).
// Additive: the existing customer card at /customers/[id] is untouched; P3c wires
// this view in as the default card with the ➕ composer + AI mic + info panel.

import MessengerTimeline from '@/components/customers/MessengerTimeline';

export default async function CustomerChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MessengerTimeline customerId={id} />;
}
