// Opiflow brand mark — a circular "flow ring" (request → act → done → retain)
// with a leading node and a core dot, set on the brand's dark-navy tile.
// Mirrors public/icon.svg so the in-app logo and the home-screen icon match.
//
// Pure/presentational. Use <OpiflowMark/> for the tile glyph and
// <OpiflowWordmark/> for the full "[mark] opiflow.ai" lockup.

import React from 'react';

export function OpiflowMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Opiflow">
      <rect width="32" height="32" rx="8" fill="#0A1120" />
      <circle
        cx="16"
        cy="16"
        r="9"
        fill="none"
        stroke="#00C499"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="44 13"
        transform="rotate(-90 16 16)"
      />
      <circle cx="16" cy="6.8" r="1.7" fill="#00C499" />
      <circle cx="16" cy="16" r="2" fill="#00C499" />
    </svg>
  );
}

export function OpiflowWordmark({
  markClassName = 'h-8 w-8',
  textClassName = 'text-lg font-bold tracking-tight',
}: {
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <OpiflowMark className={markClassName} />
      <span className={textClassName}>
        <span className="text-zinc-900">opiflow</span>
        <span className="text-indigo-600">.ai</span>
      </span>
    </div>
  );
}
