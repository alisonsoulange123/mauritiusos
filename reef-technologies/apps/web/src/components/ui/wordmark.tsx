import { cn } from '@/shared/lib/cn';

type WordmarkSize = 'sm' | 'md' | 'lg';

/**
 * The Reef Technologies wordmark — typographic, with no symbol.
 *
 * A logotype rather than a mark, because the product is an editorial,
 * text-first platform and a graphic icon would be the only ornament on the
 * page. Two decisions carry it:
 *
 *  • Tracking is size-dependent and INVERSE. Letterspacing that reads as
 *    precise at 12px looks slack at 40px, so it tightens as the mark grows.
 *    This is the single most common giveaway of an unconsidered wordmark.
 *
 *  • Medium weight, not bold. At wide tracking, bold turns into noise; medium
 *    holds the horizontal rhythm between letters.
 */
const SIZES: Record<WordmarkSize, string> = {
  sm: 'text-[0.8125rem] tracking-[0.2em]',
  md: 'text-[0.9375rem] tracking-[0.17em]',
  lg: 'text-[clamp(1.5rem,1rem+1.6vw,2.25rem)] tracking-[0.08em]',
};

export interface WordmarkProps {
  size?: WordmarkSize;
  className?: string;
  /** Renders as a plain span when the mark is already inside a link. */
  as?: 'span' | 'div';
}

export function Wordmark({ size = 'md', className, as: Tag = 'span' }: WordmarkProps) {
  return (
    <Tag
      className={cn('inline-block select-none font-medium uppercase leading-none', SIZES[size], className)}
      // The visual mark is letterspaced; screen readers should still hear a word.
      aria-label="Reef Technologies"
    >
      <span aria-hidden="true">Reef Technologies</span>
    </Tag>
  );
}
