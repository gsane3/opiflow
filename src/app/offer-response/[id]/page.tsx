import OfferResponseClient from './OfferResponseClient';

export default async function OfferResponsePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OfferResponseClient offerId={id} />;
}
