import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * The small uppercase label above a heading.
 *
 * Does the work a coloured badge would do in a louder design: it categorises
 * without introducing a second colour or a filled shape.
 */
export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-eyebrow uppercase text-muted', className)} {...props} />;
}
