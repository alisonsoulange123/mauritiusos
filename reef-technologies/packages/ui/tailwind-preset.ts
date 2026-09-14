import type { Config } from 'tailwindcss';

/**
 * The design system's single source of truth.
 *
 * Direction: editorial minimalism in the Swiss / International Typographic
 * tradition — monochrome, hairline rules, a strict grid, and type doing the
 * work that colour and ornament would otherwise do.
 *
 * Colours are declared as raw RGB channels in `globals.css` and consumed here
 * through `<alpha-value>`. That indirection is what makes `text-ink/60` and
 * `border-hairline/12` work: a plain `var(--x)` colour silently breaks every
 * Tailwind opacity modifier, which is the usual reason a token system ends up
 * abandoned halfway.
 */
const preset: Omit<Config, 'content'> = {
  // Follows the OS. The previous 'class' strategy had no toggle anywhere, so
  // every `dark:` utility in the codebase was dead.
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        /** Page ground. Warm off-white, not pure #fff — easier on the eye. */
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        /** Primary text. Near-black, never pure #000. */
        ink: 'rgb(var(--ink) / <alpha-value>)',
        /** Secondary text: captions, metadata, supporting copy. */
        muted: 'rgb(var(--muted) / <alpha-value>)',
        /** Raised surfaces — cards, inputs. */
        surface: 'rgb(var(--surface) / <alpha-value>)',
        /** Rules and borders. Always used with an opacity modifier. */
        hairline: 'rgb(var(--hairline) / <alpha-value>)',
        /** Inverted pair, for the primary button and dark blocks. */
        inverse: 'rgb(var(--inverse) / <alpha-value>)',
        'inverse-ink': 'rgb(var(--inverse-ink) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'Helvetica Neue', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      /**
       * A deliberate editorial scale, not Tailwind's default ramp.
       *
       * `clamp()` rather than breakpoint jumps: a headline should grow with the
       * viewport continuously, so there is no width at which the layout looks
       * like it was designed for a different screen. Optical tracking tightens
       * as size increases, which is why each step carries its own value.
       */
      fontSize: {
        eyebrow: ['0.6875rem', { lineHeight: '1.1', letterSpacing: '0.18em', fontWeight: '500' }],
        display: [
          'clamp(2.5rem, 1.1rem + 5.4vw, 5rem)',
          { lineHeight: '0.97', letterSpacing: '-0.035em', fontWeight: '500' },
        ],
        title: [
          'clamp(1.75rem, 1.1rem + 2.1vw, 2.625rem)',
          { lineHeight: '1.08', letterSpacing: '-0.027em', fontWeight: '500' },
        ],
        heading: ['1.25rem', { lineHeight: '1.25', letterSpacing: '-0.018em', fontWeight: '500' }],
        lead: [
          'clamp(1.0625rem, 0.96rem + 0.42vw, 1.3125rem)',
          { lineHeight: '1.52', letterSpacing: '-0.011em' },
        ],
        body: ['0.9375rem', { lineHeight: '1.62', letterSpacing: '-0.006em' }],
        caption: ['0.8125rem', { lineHeight: '1.5', letterSpacing: '0' }],
      },
      spacing: {
        /** Vertical rhythm between full-width editorial sections. */
        section: 'clamp(4.5rem, 2rem + 9vw, 9rem)',
        gutter: 'clamp(1.25rem, 0.5rem + 2.6vw, 2.5rem)',
      },
      maxWidth: {
        /** The grid. 1280 with gutters lands at a ~72ch measure for body copy. */
        grid: '80rem',
        /** Comfortable reading measure — roughly 62 characters. */
        prose: '34rem',
      },
      borderRadius: { xl: '0.875rem' },
      transitionTimingFunction: {
        /** One easing curve for the whole product. Restraint over variety. */
        editorial: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
      keyframes: {
        'rise-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { 'rise-in': 'rise-in 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) both' },
    },
  },
  plugins: [],
};

export default preset;
