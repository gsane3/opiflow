import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Element to render as. Defaults to `div`. */
  as?: ElementType;
  /** Inner padding. Defaults to `md`. */
  padding?: CardPadding;
  children?: ReactNode;
}

/**
 * Soft white surface — the app's standard container.
 * `rounded-[22px]` (native card radius), hairline zinc ring, subtle shadow.
 */
export function Card({
  as,
  padding = 'md',
  className,
  children,
  ...props
}: CardProps) {
  const Component = as ?? 'div';

  return (
    <Component
      className={cn(
        'rounded-[22px] bg-white shadow-sm shadow-indigo-950/[0.04] ring-1 ring-zinc-200/60 dark:bg-[#17232f] dark:ring-white/10',
        paddingClasses[padding],
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export default Card;
