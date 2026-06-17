// The customer card = the prototype's profile screen (avatar · status · round
// actions · AI call brief · Έργα · στοιχεία · note). Messaging happens inside a
// project (the per-project «Διαδικασία», opened via «Μήνυμα» or an «Έργο»); there
// is no separate customer-level chat screen.
import CustomerProfile from '@/components/customers/CustomerProfile';

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerProfile customerId={id} />;
}
