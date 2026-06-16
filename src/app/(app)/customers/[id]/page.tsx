// The customer card = the prototype's profile screen (avatar · status · round
// actions · AI call brief · Έργα · στοιχεία · note). The Messenger workspace
// lives at /customers/[id]/chat and is reached from the «Μήνυμα» action or an
// «Έργο» (the per-project «Διαδικασία»).
import CustomerProfile from '@/components/customers/CustomerProfile';

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerProfile customerId={id} />;
}
