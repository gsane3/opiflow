import Link from 'next/link';
import type { CommunicationRecord } from '@/lib/types';

function formatTime(isoStr: string): string {
  const date = new Date(isoStr);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dateStr = date.toISOString().split('T')[0];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const timeStr = date.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' });
  if (dateStr === todayStr) return `σήμερα ${timeStr}`;
  if (dateStr === yesterdayStr) return `χθες ${timeStr}`;
  return date.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' }) + ` ${timeStr}`;
}

function CallCommIcon() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-50 ring-1 ring-teal-200">
      <svg className="h-3.5 w-3.5 text-teal-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 6Z" />
      </svg>
    </div>
  );
}

function SmsCommIcon() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-50 ring-1 ring-violet-200">
      <svg className="h-3.5 w-3.5 text-violet-600" fill="none" strokeWidth={1.5} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 0 1 .865-.501 48.172 48.172 0 0 0 3.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" />
      </svg>
    </div>
  );
}

interface Props {
  communications: CommunicationRecord[];
  customerMap: Record<string, string>;
}

export default function RecentCommunicationsSection({ communications, customerMap }: Props) {
  const recent = [...communications]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  if (recent.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Πρόσφατες επικοινωνίες
      </h2>
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-zinc-100 overflow-hidden">
        <ul className="divide-y divide-zinc-100">
          {recent.map((comm) => {
            const customerName = comm.customerId ? customerMap[comm.customerId] : undefined;
            const title = comm.channel === 'sms' ? 'SMS από CRM' : 'Κλήση από CRM';
            const detail = [customerName, comm.phone].filter(Boolean).join(' · ');
            const timeLabel = formatTime(comm.createdAt);
            const icon = comm.channel === 'sms' ? <SmsCommIcon /> : <CallCommIcon />;

            const inner = (
              <div className="flex items-center gap-3 px-4 py-3">
                {icon}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800">{title}</p>
                  <p className="truncate text-xs text-zinc-400">
                    {detail ? `${detail} · ${timeLabel}` : timeLabel}
                  </p>
                </div>
              </div>
            );

            return (
              <li key={comm.id}>
                {comm.customerId ? (
                  <Link
                    href={`/customers/${comm.customerId}`}
                    className="block transition hover:bg-zinc-50"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
