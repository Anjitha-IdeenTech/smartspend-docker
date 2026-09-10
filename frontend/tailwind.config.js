/** @type {import('tailwindcss').Config} */

// Every theme color is a CSS var holding raw RGB channels; wrapping with
// rgb(var(--x) / <alpha-value>) lets opacity modifiers (bg-brand/10) work.
const ch = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        outfit: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      // Cool navy-blue shadows — replace Tailwind's grey shadows so every
      // existing shadow-sm/lg/xl/2xl reads as a premium, low-opacity lift in
      // the brand's blue family rather than a neutral grey drop.
      boxShadow: {
        sm:     '0 2px 8px rgba(19,46,110,0.06)',
        DEFAULT:'0 8px 24px rgba(19,46,110,0.08)',
        md:     '0 10px 30px rgba(19,46,110,0.09)',
        lg:     '0 16px 40px rgba(19,46,110,0.11)',
        xl:     '0 20px 50px rgba(19,46,110,0.12)',
        '2xl':  '0 28px 60px rgba(19,46,110,0.14)',
      },
      // Softer corners across the board (no sharp borders) — cards land at 22px.
      borderRadius: {
        lg:    '12px',
        xl:    '16px',
        '2xl': '22px',
      },
      colors: {
        // neutral canvas
        app:         ch('--bg-app'),
        surface:     ch('--bg-surface'),
        secondary:   ch('--bg-secondary'),
        raised:      ch('--bg-raised'),
        borderTheme: ch('--border-color'),
        line2:       ch('--border-strong'),
        // text
        textPrimary:   ch('--text-primary'),
        textSecondary: ch('--text-secondary'),
        textFaint:     ch('--text-faint'),
        onbrand:       ch('--onbrand'),
        // brand + semantic aliases (map onto the accent vars)
        brand: ch('--accent-budget'),
        gold:  ch('--accent-approvals'),
        pos:   ch('--accent-savings'),
        neg:   ch('--accent-expenses'),
        info:  ch('--accent-analytics'),
        // original per-domain accent scale (kept for Scene 1 + charts)
        accent: {
          budget:    ch('--accent-budget'),
          savings:   ch('--accent-savings'),
          expenses:  ch('--accent-expenses'),
          approvals: ch('--accent-approvals'),
          analytics: ch('--accent-analytics'),
          alerts:    ch('--accent-alerts'),
        },
        // soft pastel accent palette (for chart series / decorative fills)
        pastel: {
          pink:   '#FFB6D9',
          purple: '#CDBDFF',
          sky:    '#D9F2FF',
          peach:  '#FFE4D4',
          mint:   '#DDF7EC',
        },
      },
    },
  },
  plugins: [],
}
