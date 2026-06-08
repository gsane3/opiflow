'use client';

// CollapsibleSection — a simple expandable Card used by the customer detail
// screen to keep secondary sections (Ιστορικό, Κλήσεις, Ραντεβού, Προσφορές,
// Σημειώσεις, Αρχεία) tucked away until the operator needs them.
//
// It is intentionally co-located (NOT in the ui/ barrel) and import-directly.
// It supports BOTH controlled (open + onToggle) and uncontrolled
// (defaultOpen) usage so callers can either drive it externally (e.g. an
// "Άλλα" sheet that reveals the Files section) or let it manage its own state.

import React, { useId, useState } from 'react';

export interface CollapsibleSectionProps {
  /** Section heading (plain Greek, e.g. "Ιστορικό"). */
  title: React.ReactNode;
  /** Optional small subtitle under the title. */
  description?: React.ReactNode;
  /** Optional node shown at the right of the header (e.g. a count badge). */
  badge?: React.ReactNode;
  /** Optional id forwarded to the <section> (for scroll-into-view). */
  id?: string;
  /** Uncontrolled initial open state. Ignored when `open` is provided. */
  defaultOpen?: boolean;
  /** Controlled open state. When provided, `onToggle` should update it. */
  open?: boolean;
  /** Controlled toggle callback. Receives the next open value. */
  onToggle?: (next: boolean) => void;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  title,
  description,
  badge,
  id,
  defaultOpen = false,
  open,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const expanded = isControlled ? (open as boolean) : internalOpen;
  const bodyId = useId();

  function toggle() {
    const next = !expanded;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  }

  return (
    <section
      id={id}
      className="overflow-hidden rounded-[28px] bg-white shadow-sm ring-1 ring-zinc-200/60"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-zinc-50"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
            {badge != null && <span className="shrink-0">{badge}</span>}
          </div>
          {description != null && (
            <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
          )}
        </div>
        <svg
          className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          strokeWidth={2}
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {expanded && (
        <div id={bodyId} className="border-t border-zinc-100">
          {children}
        </div>
      )}
    </section>
  );
}
