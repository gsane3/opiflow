'use client';

// Mobile-first bottom-sheet primitive.
//
// A single reusable overlay that the app uses for option lists, quick actions,
// and review-first flows. On phones it anchors to the bottom edge and slides up
// (the native "sheet" gesture-language); on >=md it becomes a centered dialog.
//
// Matches the house overlay pattern (fixed inset-0 z-50, rounded-[28px], round
// close X) used by BottomNav's "Περισσότερα" modal and SendViaViberModal, and is
// dependency-free / portal-free to stay consistent with those inline overlays.

import React, { useEffect } from 'react';
import { cn } from './cn';

export interface BottomSheetProps {
  /** Controls visibility. When false the component renders `null`. */
  open: boolean;
  /** Called when the user dismisses (overlay click, X, or Escape). */
  onClose: () => void;
  /** Optional heading shown top-left. */
  title?: React.ReactNode;
  /** Optional small subtitle under the title. */
  description?: React.ReactNode;
  /** Sheet body (scrolls if it overflows). */
  children: React.ReactNode;
  /** Optional sticky footer area pinned to the bottom of the panel. */
  footer?: React.ReactNode;
  /** Extra classes merged onto the panel. */
  className?: string;
}

/** Round close (X) button — matches the house pattern. */
function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Κλείσιμο"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-[#1e2b38] text-zinc-500 dark:text-zinc-400 transition hover:bg-zinc-200 dark:hover:bg-white/5"
    >
      <svg className="h-4 w-4" fill="none" strokeWidth={2} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: BottomSheetProps) {
  // Close on Escape + lock body scroll while open.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    const hasDocument = typeof document !== 'undefined';
    const prevOverflow = hasDocument ? document.body.style.overflow : '';
    if (hasDocument) document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (hasDocument) document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 animate-[fadeIn_0.2s_ease-out] md:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex max-h-[85vh] w-full flex-col bg-white dark:bg-[#17232f] shadow-2xl ring-1 ring-zinc-200/60 dark:ring-white/10',
          'rounded-t-[28px] animate-[sheetUp_0.28s_ease-out]',
          'pb-[env(safe-area-inset-bottom)]',
          'md:max-w-md md:rounded-[28px]',
          className,
        )}
      >
        {/* Grab handle (mobile affordance) */}
        <div className="flex justify-center pb-1 pt-3 md:hidden">
          <span className="h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-white/10" />
        </div>

        {/* Header — the close button is always present even without a title. */}
        <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-2 md:pt-5">
          <div className="min-w-0 flex-1">
            {title != null && (
              <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
            )}
            {description != null && (
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
            )}
          </div>
          <CloseButton onClose={onClose} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 pt-1">{children}</div>

        {/* Sticky footer */}
        {footer != null && (
          <div className="border-t border-zinc-100 dark:border-white/10 px-5 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

export interface SheetRowProps {
  /** Optional leading icon, shown in a zinc-100 circle. */
  icon?: React.ReactNode;
  /** Primary row label. */
  label: React.ReactNode;
  /** Optional secondary line under the label. */
  description?: React.ReactNode;
  /** Click handler. */
  onClick?: () => void;
  /** Optional node pinned to the right (e.g. chevron, badge). */
  trailing?: React.ReactNode;
  /** `danger` renders the label in red with a red hover. */
  tone?: 'default' | 'danger';
  /** Disables the row. */
  disabled?: boolean;
}

/**
 * Composable full-width option row for use inside a BottomSheet body.
 * Min 52px tall for a comfortable tap target.
 */
export function SheetRow({
  icon,
  label,
  description,
  onClick,
  trailing,
  tone = 'default',
  disabled = false,
}: SheetRowProps) {
  const isDanger = tone === 'danger';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-4 py-3 text-left',
        'text-[15px] font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        isDanger
          ? 'text-red-600 hover:bg-red-50'
          : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-white/5',
      )}
    >
      {icon != null && (
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            isDanger ? 'bg-red-50 text-red-500' : 'bg-zinc-100 dark:bg-[#1e2b38] text-zinc-500 dark:text-zinc-400',
          )}
        >
          {icon}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {description != null && (
          <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">{description}</span>
        )}
      </span>

      {trailing != null && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}

export default BottomSheet;
