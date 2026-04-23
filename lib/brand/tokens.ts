// lib/brand/tokens.ts
// CSS variable reference strings for React inline styles.
// Changing brand.css custom properties (e.g. for white-label) automatically
// propagates through these references — no component changes needed.

export const C = {
  accent:      'rgb(var(--accent-primary))',
  accentHov:   'rgb(var(--accent-primary-hover))',
  bg:          'rgb(var(--bg-primary))',
  bgSurface:   'rgb(var(--bg-surface))',
  bgSecondary: 'rgb(var(--bg-secondary))',
  text:        'rgb(var(--text-primary))',
  textSec:     'rgb(var(--text-secondary))',
  textMuted:   'rgb(var(--text-muted))',
  danger:      'rgb(var(--tone-danger))',
  success:     'rgb(var(--tone-success))',
  white:       '#ffffff',
  fontDisplay: 'var(--font-display)',
  fontMono:    'var(--font-mono)',
  fontSans:    'var(--font-sans)',
} as const

/** --text-primary at alpha 0–1  e.g. textAt(0.7) → "rgb(var(--text-primary) / 0.7)" */
export const textAt = (a: number) => `rgb(var(--text-primary) / ${a})`

/** --accent-primary at alpha 0–1 */
export const accentAt = (a: number) => `rgb(var(--accent-primary) / ${a})`

/** --bg-primary at alpha 0–1 */
export const bgAt = (a: number) => `rgb(var(--bg-primary) / ${a})`

/** --bg-surface at alpha 0–1 */
export const bgSurfaceAt = (a: number) => `rgb(var(--bg-surface) / ${a})`

/** --bg-secondary at alpha 0–1 */
export const bgSecAt = (a: number) => `rgb(var(--bg-secondary) / ${a})`

/** --tone-danger at alpha 0–1 */
export const dangerAt = (a: number) => `rgb(var(--tone-danger) / ${a})`

/** --tone-success at alpha 0–1 */
export const successAt = (a: number) => `rgb(var(--tone-success) / ${a})`
