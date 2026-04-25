// tailwind.config.js
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],

  theme: {
    extend: {
      colors: {
        // ── Semantic tokens used by existing components ─────────────
        bgPrimary: 'rgb(var(--bg-primary) / <alpha-value>)',
        bgSecondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
        bgSurface: 'rgb(var(--bg-surface) / <alpha-value>)',

        textPrimary: 'rgb(var(--text-primary) / <alpha-value>)',
        textSecondary: 'rgb(var(--text-secondary) / <alpha-value>)',
        textMuted: 'rgb(var(--text-muted) / <alpha-value>)',

        surfaceGlass: 'rgb(var(--surface-glass) / <alpha-value>)',

        accentPrimary: 'rgb(var(--accent-primary) / <alpha-value>)',
        accentPrimaryHover: 'rgb(var(--accent-primary-hover) / <alpha-value>)',
        microAccent: 'rgb(var(--micro-accent) / <alpha-value>)',

        toneDanger: 'rgb(var(--tone-danger) / <alpha-value>)',
        toneWarn: 'rgb(var(--tone-warn) / <alpha-value>)',
        tonePending: 'rgb(var(--tone-pending) / <alpha-value>)',
        toneSuccess: 'rgb(var(--tone-success) / <alpha-value>)',
        toneInfo: 'rgb(var(--tone-info) / <alpha-value>)',

        overlay: 'rgb(var(--overlay) / <alpha-value>)',

        // ── Prototype aliases used by editorial/new screens ─────────
        ink: 'rgb(var(--ink) / <alpha-value>)',
        ink2: 'rgb(var(--ink-2) / <alpha-value>)',
        ink3: 'rgb(var(--ink-3) / <alpha-value>)',

        paper: 'rgb(var(--paper) / <alpha-value>)',
        paperDim: 'rgb(var(--paper-dim) / <alpha-value>)',
        paperMute: 'rgb(var(--paper-mute) / <alpha-value>)',

        terra: 'rgb(var(--terra) / <alpha-value>)',
        terraGlow: 'rgb(var(--terra-glow) / <alpha-value>)',

        acid: 'rgb(var(--acid) / <alpha-value>)',
        fern: 'rgb(var(--fern) / <alpha-value>)',
        ember: 'rgb(var(--ember) / <alpha-value>)',
        amber: 'rgb(var(--amber) / <alpha-value>)',
      },

      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },

      borderRadius: {
        appIcon: 'var(--radius-app-icon)',
        card: 'var(--radius-card)',
        inner: 'var(--radius-inner)',
      },

      backdropBlur: {
        app: 'var(--glass-blur)',
      },
    },
  },

  plugins: [],
}