import type { SVGProps } from 'react';
import { cn } from './cn';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

const sizeClasses: Record<SpinnerSize, string> = {
  xs: 'h-3.5 w-3.5',
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

export interface SpinnerProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: SpinnerSize;
  /** Accessible label. Defaults to Greek "Φόρτωση…". */
  label?: string;
}

/**
 * Indeterminate loading spinner. Inherits the current text color
 * (`currentColor`), so place it inside any colored element.
 */
export function Spinner({
  size = 'md',
  label = 'Φόρτωση…',
  className,
  ...props
}: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('animate-spin text-current', sizeClasses[size], className)}
      {...props}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default Spinner;
