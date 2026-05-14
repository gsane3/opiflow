import OfferPreview from '@/components/offers/OfferPreview';

export default async function OfferPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <OfferPreview key={id} offerId={id} />;
}
