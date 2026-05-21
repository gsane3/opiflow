import IntakeFormClient from './IntakeFormClient';

export default async function IntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <IntakeFormClient token={token} />;
}
