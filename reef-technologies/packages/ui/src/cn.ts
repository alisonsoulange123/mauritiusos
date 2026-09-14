import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge, taught about our custom scales.
 *
 * This configuration is not optional polish — without it the design system is
 * quietly broken. tailwind-merge resolves conflicts by classifying each class
 * into a group, and it only knows Tailwind's DEFAULT scales. Our type scale
 * renames every size (`text-body`, `text-caption`, `text-display`…), so an
 * unconfigured merge cannot tell `text-body` (a font size) from
 * `text-inverse-ink` (a colour), decides they conflict, and silently drops the
 * one that came first.
 *
 * The symptom is a primary button rendering its label in the background
 * colour: invisible text, no error, nothing in the console. Declaring the
 * scales below is what keeps `cn('text-inverse-ink', 'text-body')` from
 * discarding the colour.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Every key from the preset's `fontSize`. Anything else starting with
      // `text-` is then correctly treated as a colour.
      'font-size': [{ text: ['eyebrow', 'display', 'title', 'heading', 'lead', 'body', 'caption'] }],
    },
  },
});

/**
 * Merges class names with later Tailwind utilities winning.
 * Without the merge, `cn('p-2', 'p-4')` emits both and the outcome depends on
 * stylesheet order — which is how "the prop does nothing" bugs happen.
 */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs));
