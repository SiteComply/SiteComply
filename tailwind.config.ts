import type { Config } from 'tailwindcss';

/**
 * SiteComply design tokens.
 *
 * Colours are exposed as CSS custom properties (see app/globals.css) and mapped
 * here so they can be re-themed without touching component code. The palette is
 * tuned for outdoor readability: high-contrast neutrals, a trustworthy brand
 * navy/blue for primary actions, hi-vis amber as the construction accent, and a
 * clear safety green / danger red for compliance status.
 *
 * Tokens use the `rgb(var(--token) / <alpha-value>)` pattern so Tailwind opacity
 * modifiers (e.g. `bg-brand-600/20`) continue to work.
 */
const withVar = (token: string) => `rgb(var(${token}) / <alpha-value>)`;

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: withVar('--brand-50'),
          100: withVar('--brand-100'),
          200: withVar('--brand-200'),
          500: withVar('--brand-500'),
          600: withVar('--brand-600'),
          700: withVar('--brand-700'),
          800: withVar('--brand-800'),
          900: withVar('--brand-900'),
        },
        hivis: {
          400: withVar('--hivis-400'),
          500: withVar('--hivis-500'),
          600: withVar('--hivis-600'),
        },
        safe: {
          50: withVar('--safe-50'),
          500: withVar('--safe-500'),
          600: withVar('--safe-600'),
          700: withVar('--safe-700'),
        },
        danger: {
          50: withVar('--danger-50'),
          500: withVar('--danger-500'),
          600: withVar('--danger-600'),
          700: withVar('--danger-700'),
        },
        ink: {
          DEFAULT: withVar('--ink'),
          muted: withVar('--ink-muted'),
          subtle: withVar('--ink-subtle'),
        },
        surface: {
          DEFAULT: withVar('--surface'),
          raised: withVar('--surface-raised'),
          sunken: withVar('--surface-sunken'),
        },
        line: withVar('--line'),
      },
      borderRadius: {
        // Generous default radii read as friendly and modern on touch screens.
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      minHeight: {
        // Minimum comfortable touch target (WCAG 2.5.5 / outdoor-with-gloves use).
        touch: '3.25rem',
      },
      minWidth: {
        touch: '3.25rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px rgb(15 23 42 / 0.06)',
      },
      keyframes: {
        // Gentle drop-in for notification toasts. Reduced-motion users have all
        // animations neutralised globally (see globals.css).
        'toast-in': {
          '0%': { opacity: '0', transform: 'translateY(-0.5rem)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'toast-in': 'toast-in 0.2s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'pop-in': 'pop-in 0.15s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
