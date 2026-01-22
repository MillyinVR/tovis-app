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
        bgPrimary: 'rgb(var(--bg-primary) / <alpha-value>)',
        bgSecondary: 'rgb(var(--bg-secondary) / <alpha-value>)',
        textPrimary: 'rgb(var(--text-primary) / <alpha-value>)',
        textSecondary: 'rgb(var(--text-secondary) / <alpha-value>)',
        surfaceGlass: 'rgb(var(--surface-glass) / <alpha-value>)',

        accentPrimary: 'rgb(var(--accent-primary) / <alpha-value>)',
        accentPrimaryHover: 'rgb(var(--accent-primary-hover) / <alpha-value>)',
        microAccent: 'rgb(var(--micro-accent) / <alpha-value>)',

        toneDanger: 'rgb(var(--tone-danger) / <alpha-value>)',
        toneWarn: 'rgb(var(--tone-warn) / <alpha-value>)',
        toneSuccess: 'rgb(var(--tone-success) / <alpha-value>)',
        toneInfo: 'rgb(var(--tone-info) / <alpha-value>)',

        overlay: 'rgb(var(--overlay) / <alpha-value>)',
      },
      borderRadius: {
        appIcon: 'var(--radius-app-icon)',
        card: 'var(--radius-card)',
      },
      backdropBlur: {
        app: 'var(--glass-blur)',
      },
    },
  },
  plugins: [],
}
