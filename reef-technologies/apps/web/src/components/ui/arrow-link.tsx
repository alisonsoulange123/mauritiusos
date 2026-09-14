'use client';

import Link from 'next/link';
import { cn } from '@/shared/lib/cn';

export interface ArrowLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A text link with a trailing arrow that advances on hover.
 *
 * The entire motion budget of this design, spent in one place. The arrow moves
 * 3px — enough to register as responsive, small enough that it never reads as
 * an animation. `group-hover` drives it from the link so the whole target
 * responds, not just the glyph.
 */
export function ArrowLink({ href, children, className }: ArrowLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex items-baseline gap-1.5 text-body font-medium text-ink',
        'decoration-hairline/30 underline-offset-[5px] hover:underline',
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className="translate-y-[1px] transition-transform duration-300 ease-editorial group-hover:translate-x-[3px]"
      >
        →
      </span>
    </Link>
  );
}
