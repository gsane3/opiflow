import type { Offer } from '@/lib/types';

// Extract the rejection reason text from offer notes (demo notes format).
function extractRejectionReason(notes: string): string {
  const line = notes.split('\n').find((l) => l.includes('Απόρριψη demo:'));
  if (!line) return '';
  const idx = line.indexOf('Απόρριψη demo:');
  return line.slice(idx + 'Απόρριψη demo:'.length).trim();
}

function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-4 ring-1 ${
        accent ? 'bg-indigo-50 ring-indigo-100' : 'bg-white ring-zinc-100 shadow-sm'
      }`}
    >
      <p className="text-xs text-zinc-500">{label}</p>
      <p
        className={`mt-1 text-xl font-bold ${
          accent ? 'text-indigo-700' : 'text-zinc-900'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

interface StatusPillProps {
  label: string;
  count: number;
  color: string;
}

function StatusPill({ label, count, color }: StatusPillProps) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>
      <span>{count}</span>
      <span>{label}</span>
    </div>
  );
}

interface Props {
  offers: Offer[];
}

export default function OfferAnalyticsPanel({ offers }: Props) {
  if (offers.length === 0) {
    return null;
  }

  const total = offers.length;
  const draft = offers.filter((o) => o.status === 'draft').length;
  const ready = offers.filter((o) => o.status === 'ready_to_send').length;
  const sentManually = offers.filter((o) => o.status === 'sent_manually').length;
  const accepted = offers.filter((o) => o.status === 'accepted').length;
  const rejected = offers.filter((o) => o.status === 'rejected').length;
  const expired = offers.filter((o) => o.status === 'expired').length;

  // sent = all that left draft (sent_manually + accepted + rejected)
  const sent = sentManually + accepted + rejected;
  const acceptanceRate = sent > 0 ? Math.round((accepted / sent) * 100) : 0;

  const rejectedOffers = offers.filter((o) => o.status === 'rejected');

  return (
    <div className="mb-5 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Σύνολο προσφορών" value={total} />
        <StatCard label="Στάλθηκαν" value={sent} />
        <StatCard label="Αποδεκτές" value={accepted} accent={accepted > 0} />
        <StatCard label="Απορρίφθηκαν" value={rejected} />
        <StatCard
          label="Ποσοστό αποδοχής"
          value={`${acceptanceRate}%`}
          sub={sent > 0 ? `${accepted} από ${sent} που στάλθηκαν` : 'Καμία στάλθηκε ακόμα'}
          accent={acceptanceRate > 0}
        />
      </div>

      {/* Status breakdown */}
      <div className="flex flex-wrap gap-2">
        {draft > 0 && (
          <StatusPill label="Πρόχειρες" count={draft} color="bg-zinc-100 text-zinc-600" />
        )}
        {ready > 0 && (
          <StatusPill label="Έτοιμες" count={ready} color="bg-amber-100 text-amber-700" />
        )}
        {sentManually > 0 && (
          <StatusPill label="Στάλθηκαν" count={sentManually} color="bg-blue-100 text-blue-700" />
        )}
        {accepted > 0 && (
          <StatusPill label="Αποδεκτές" count={accepted} color="bg-green-100 text-green-700" />
        )}
        {rejected > 0 && (
          <StatusPill label="Απορρίφθηκαν" count={rejected} color="bg-red-100 text-red-700" />
        )}
        {expired > 0 && (
          <StatusPill label="Ληγμένες" count={expired} color="bg-zinc-100 text-zinc-400" />
        )}
      </div>

      {/* Rejection insights — only when rejected offers exist */}
      {rejectedOffers.length > 0 && (
        <div className="rounded-2xl bg-white p-4 ring-1 ring-zinc-100 shadow-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Λόγοι απόρριψης
          </p>
          <ul className="space-y-1.5">
            {rejectedOffers.map((offer) => {
              const reason = extractRejectionReason(offer.notes);
              return (
                <li key={offer.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0 text-red-400">
                    <svg className="h-3.5 w-3.5" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium text-zinc-700">{offer.offerNumber}</span>
                    {' — '}
                    <span className="text-zinc-500">
                      {reason || 'Δεν έχει καταγραφεί λόγος.'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
