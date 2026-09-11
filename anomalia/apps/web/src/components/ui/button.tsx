'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/**
 * A dumb primitive. No API calls, no business rules, no feature imports — the
 * boundary linter enforces all three.
 *
 * Pill geometry and a monochrome palette: with only two weights available
 * (filled and outlined), hierarchy has to come from fill, so there is never a
 * question about which action is primary on a screen.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-inverse text-inverse-ink hover:bg-inverse/90',
  secondary: 'border border-hairline/[0.18] text-ink hover:border-hairline/40 hover:bg-ink/[0.03]',
  ghost: 'text-ink hover:bg-ink/[0.05]',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-caption',
  md: 'h-10 px-5 text-body',
  lg: 'h-12 px-6 text-body',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium',
        'transition-colors duration-200 ease-editorial',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
