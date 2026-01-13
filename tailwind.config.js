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
        microAccent: 'rgb(var(--micro-accent) / <alpha-value>)',
      },
      borderRadius: {
        appIcon: 'var(--radius-app-icon)',
        appCard: 'var(--radius-app-card)',
      },
      boxShadow: {
        appCard: 'var(--shadow-card)',
      },
      backdropBlur: {
        app: 'var(--glass-blur)',
      },
    },
  },
  plugins: [],
}
