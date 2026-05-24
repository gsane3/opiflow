import AppointmentResponseClient from './AppointmentResponseClient';

export default async function AppointmentResponsePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const token = (await params).id;
  return <AppointmentResponseClient token={token} />;
}
