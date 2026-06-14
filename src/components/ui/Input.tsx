'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible field label. Rendered as a real <label> wired via htmlFor/id. */
  label?: ReactNode;
  /** Error message shown below the field; also flips the field to an error style. */
  error?: ReactNode;
  /** Helper text shown below the field when there is no error. */
  hint?: ReactNode;
  /** Wrapper element class (the label + control + message group). */
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    id,
    className,
    wrapperClassName,
    required,
    'aria-describedby': describedByProp,
    ...props
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const hasError = Boolean(error);
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  const describedBy =
    [
      typeof describedByProp === 'string' ? describedByProp : undefined,
      hasError ? errorId : undefined,
      !hasError && hint ? hintId : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={cn('w-full', wrapperClassName)}>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200"
        >
          {label}
          {required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
        </label>
      )}

      <input
        ref={ref}
        id={inputId}
        required={required}
        aria-invalid={hasError || undefined}
        aria-describedby={describedBy}
        // text-base (16px) prevents iOS Safari from auto-zooming on focus.
        className={cn(
          'w-full rounded-xl border bg-white dark:bg-[#0f1923] px-4 py-2.5 text-base text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500',
          'transition-colors focus:outline-none focus:ring-2',
          'disabled:cursor-not-allowed disabled:bg-zinc-50 dark:disabled:bg-[#1e2b38] disabled:text-zinc-400 dark:disabled:text-zinc-500',
          hasError
            ? 'border-red-300 focus:border-red-400 focus:ring-red-500'
            : 'border-zinc-200 dark:border-white/10 focus:border-indigo-400 focus:ring-indigo-500',
          className,
        )}
        {...props}
      />

      {hasError ? (
        <p id={errorId} className="mt-1 text-sm text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Input;
