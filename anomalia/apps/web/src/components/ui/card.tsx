import type { HTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * A hairline-bounded surface. No shadow, deliberately: drop shadows imply
 * depth, and this design has one plane. Separation comes from rules and space.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-hairline/[0.12] bg-surface p-6 md:p-8', className)}
      {...props}
    />
  );
}
