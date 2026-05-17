import AppointmentResponseClient from './AppointmentResponseClient';

export default async function AppointmentResponsePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AppointmentResponseClient taskId={id} />;
}
