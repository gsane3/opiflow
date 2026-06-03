'use client';

import { forwardRef, useId, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Visible field label. Rendered as a real <label> wired via htmlFor/id. */
  label?: ReactNode;
  /** Error message shown below the field; also flips the field to an error style. */
  error?: ReactNode;
  /** Helper text shown below the field when there is no error. */
  hint?: ReactNode;
  /** Wrapper element class (the label + control + message group). */
  wrapperClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    {
      label,
      error,
      hint,
      id,
      className,
      wrapperClassName,
      required,
      rows = 4,
      'aria-describedby': describedByProp,
      ...props
    },
    ref,
  ) {
    const reactId = useId();
    const textareaId = id ?? reactId;
    const hasError = Boolean(error);
    const errorId = `${textareaId}-error`;
    const hintId = `${textareaId}-hint`;

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
            htmlFor={textareaId}
            className="mb-1 block text-sm font-medium text-zinc-700"
          >
            {label}
            {required && (
              <span className="ml-0.5 text-red-500" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          rows={rows}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          // text-base (16px) prevents iOS Safari from auto-zooming on focus.
          className={cn(
            'w-full resize-y rounded-xl border bg-white px-4 py-2.5 text-base text-zinc-900 placeholder-zinc-400',
            'transition-colors focus:outline-none focus:ring-2',
            'disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400',
            hasError
              ? 'border-red-300 focus:border-red-400 focus:ring-red-500'
              : 'border-zinc-200 focus:border-indigo-400 focus:ring-indigo-500',
            className,
          )}
          {...props}
        />

        {hasError ? (
          <p id={errorId} className="mt-1 text-sm text-red-600">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="mt-1 text-sm text-zinc-500">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);

export default Textarea;
