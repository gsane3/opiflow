// Shimmer placeholder shaped like the content it stands in for — used instead of
// a centered spinner so screens feel "instant" (the layout is there immediately,
// like Facebook/Instagram) rather than blank-then-pop.

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-zinc-200/70 dark:bg-white/10 ${className}`}
    />
  );
}

/** A few chat-bubble-shaped skeletons, alternating sides — the loading state for
 *  the messenger timeline. */
export function ChatSkeleton() {
  const rows = [
    { mine: false, w: 'w-44' },
    { mine: true, w: 'w-32' },
    { mine: false, w: 'w-56' },
    { mine: true, w: 'w-40' },
    { mine: false, w: 'w-36' },
  ];
  return (
    <div className="space-y-3 py-2" role="status" aria-label="Φόρτωση συνομιλίας">
      {rows.map((r, i) => (
        <div key={i} className={`flex ${r.mine ? 'justify-end' : 'justify-start'}`}>
          <Skeleton className={`h-12 ${r.w} max-w-[70%] rounded-2xl ${r.mine ? 'rounded-br-md' : 'rounded-bl-md'}`} />
        </div>
      ))}
    </div>
  );
}
