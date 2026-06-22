// app/client/(gated)/_components/homeVisuals.ts
//
// Shared presentation helpers for the client home sections. Everything here is
// brand-token driven (no hardcoded hex) so the home stays white-label-ready and
// flips correctly between dark/light via the BrandProvider variable swap.
import type { ProNameDisplay } from '@prisma/client'
import { pickProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'

// Brand-token gradient pairs mirroring the design's avatar/portrait fills.
// Each pair references per-brand CSS variables (overridden by BrandProvider per
// tenant) so a white-label brand recolors them for free — no brand-constant
// tokens (e.g. --peacock-blue) here. Cycled by index for visual variety.
const GRADIENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['var(--accent-primary)', 'var(--iris)'],
  ['var(--accent-primary-hover)', 'var(--accent-primary)'],
  ['var(--gold)', 'var(--emerald)'],
  ['var(--iris)', 'var(--accent-primary-hover)'],
]

/** Radial brand-gradient fill for image-less avatars/tiles, varied by index. */
export function gradientAvatar(index: number): string {
  const pair =
    GRADIENT_PAIRS[((index % GRADIENT_PAIRS.length) + GRADIENT_PAIRS.length) % GRADIENT_PAIRS.length]
  const [from, to] = pair ?? ['var(--accent-primary)', 'var(--iris)']
  return `radial-gradient(130% 120% at 32% 20%, rgb(${from}), rgb(${to}))`
}

/** USD, whole dollars — matches the design's "$250" / "from $250" style. */
export function money(
  value: { toString(): string } | number | string | null | undefined,
): string | null {
  if (value == null) return null
  const numeric =
    typeof value === 'number' ? value : Number.parseFloat(value.toString())
  if (!Number.isFinite(numeric)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(numeric)
}

/** Minutes → "3h 15m" / "45m" / "1h". */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

/** Detect the social source from a submitted link, for the "via TikTok" tag. */
export function platformFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (host.includes('tiktok')) return 'TikTok'
  if (host.includes('instagram') || host.includes('instagr.am')) return 'Instagram'
  if (host.includes('pinterest') || host.includes('pin.it')) return 'Pinterest'
  if (host.includes('youtube') || host.includes('youtu.be')) return 'YouTube'
  return 'Link'
}

/**
 * Date + time line ("Thu, Jun 18 · 2:30 PM" via the weekday/month/day/hour/min
 * shape), honoring a time zone with a no-tz fallback. Empty string for no date.
 */
export function formatDateTime(
  date: Date | null | undefined,
  timeZone?: string | null,
): string {
  if (!date) return ''
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      ...options,
      timeZone: timeZone || undefined,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', options).format(date)
  }
}

/**
 * Public-facing professional name. Routes through the privacy-aware resolver
 * (business name → person name) with a handle fallback, so every home card
 * shows the same name the rest of the app does.
 */
export function professionalName(professional: {
  businessName?: string | null
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  nameDisplay?: ProNameDisplay | null
}): string {
  return (
    pickProfessionalPublicDisplayName(professional) ??
    professional.handle?.trim() ??
    'Professional'
  )
}

export function firstWord(name: string): string {
  return name.split(/\s+/)[0] ?? name
}
