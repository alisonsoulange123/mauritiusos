import type { ElementType, HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

export interface ContainerProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Drops the max-width so the element can span the viewport. */
  bleed?: boolean;
}

/**
 * The measure. Every section sits inside one of these, which is what keeps
 * left edges aligned down the whole page — the thing you actually notice when
 * there is no colour or ornament to look at instead.
 */
export function Container({ as: Tag = 'div', bleed = false, className, ...props }: ContainerProps) {
  return <Tag className={cn('mx-auto w-full px-gutter', !bleed && 'max-w-grid', className)} {...props} />;
}
