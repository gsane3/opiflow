'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';
import { Spinner, type SpinnerSize } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, hides label text, and disables the button. */
  loading?: boolean;
  /** Stretch to the full width of the container. */
  fullWidth?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold ' +
  'transition select-none ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0e1722] ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

// `primary` uses the native water→navy gradient (see .bg-brand-gradient in
// globals.css) so web buttons match the redesigned app.
const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-gradient text-white shadow-sm shadow-indigo-900/15 hover:opacity-95 active:opacity-90 focus-visible:ring-indigo-500',
  secondary:
    'bg-white text-zinc-800 ring-1 ring-zinc-200/80 hover:bg-zinc-50 active:bg-zinc-100 focus-visible:ring-indigo-500 dark:bg-[#1e2b38] dark:text-zinc-100 dark:ring-white/10 dark:hover:bg-[#26384a] dark:active:bg-[#26384a]',
  ghost:
    'bg-transparent text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200 focus-visible:ring-indigo-500 dark:text-zinc-200 dark:hover:bg-white/5 dark:active:bg-white/10',
  danger:
    'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 focus-visible:ring-red-500',
};

// `md` keeps a >=44px tap target (h-11) per WCAG / iOS guidance.
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-5 text-base',
};

const spinnerSize: Record<ButtonSize, SpinnerSize> = {
  sm: 'xs',
  md: 'sm',
  lg: 'sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    disabled,
    type = 'button',
    className,
    children,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        base,
        variantClasses[variant],
        sizeClasses[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={spinnerSize[size]} aria-hidden="true" />}
      {/* Keep the label in layout (opacity only) so the button width stays
          stable while loading. `aria-busy` conveys state to assistive tech. */}
      <span className={cn(loading && 'opacity-0')}>{children}</span>
    </button>
  );
});

export default Button;
