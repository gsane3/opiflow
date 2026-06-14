import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps
  // Omit the native `title` (tooltip string) — we redefine it as ReactNode content.
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional decorative icon (e.g. an SVG) shown above the title. */
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Optional call-to-action, typically a <Button>. */
  action?: ReactNode;
}

/**
 * Centered placeholder for empty lists / zero-result screens.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      {icon && (
        <div
          className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 dark:bg-[#1e2b38] text-zinc-400 dark:text-zinc-500"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}

      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>

      {description && (
        <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export default EmptyState;
