// lib/profiles/publicProfileFormatting.ts
// lib/profiles/publicProfileFormatting.ts
import type { ProfessionType, ProNameDisplay } from '@prisma/client'

// Compact counts live in lib/format/compactCount — the single source of truth
// shared with the looks rail, the comments drawer and the pro-profile manager.
// Imported (not re-exported) so there is exactly one path to it.
import { COPY } from '@/lib/copy'
import { formatCompactCount } from '@/lib/format/compactCount'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { formatProfessionLabel } from '@/lib/professions'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { sanitizeInternalPath as sanitizeInternalPathStrict } from '@/lib/security/internalPath'

// Re-exported, not re-implemented: the label map now lives in lib/professions
// (one home, shared with the signup dropdown that had forked it), and this
// module's existing importers keep their import path.
export { formatProfessionLabel }

export type PublicProfileTab = 'portfolio' | 'services' | 'reviews'

export type PublicProfileSearchParams = {
  [key: string]: string | string[] | undefined
}

export type PublicProfileTabItem = {
  id: PublicProfileTab
  label: string
}

export const PUBLIC_PROFILE_TABS: PublicProfileTabItem[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'services', label: 'Services' },
  { id: 'reviews', label: 'Reviews' },
]

const PUBLIC_PROFILE_DEFAULT_TAB: PublicProfileTab = 'portfolio'


function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function firstSearchParamValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return trimToNull(value)

  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = trimToNull(item)
      if (picked) return picked
    }
  }

  return null
}

export function isPublicProfileTab(value: unknown): value is PublicProfileTab {
  return value === 'portfolio' || value === 'services' || value === 'reviews'
}

export function pickPublicProfileTab(
  searchParams: PublicProfileSearchParams | undefined,
): PublicProfileTab {
  const tab = firstSearchParamValue(searchParams?.tab)

  return isPublicProfileTab(tab) ? tab : PUBLIC_PROFILE_DEFAULT_TAB
}

export function buildLoginHref(fromPath: string): string {
  return `/login?from=${encodeURIComponent(fromPath)}`
}

export function sanitizeLocalHref(value: string | null | undefined): string {
  return sanitizeInternalPathStrict(value) ?? '/looks'
}

export function buildProfessionalProfileHref(args: {
  professionalId: string
  tab?: PublicProfileTab
}): string {
  const base = `/professionals/${encodeURIComponent(args.professionalId)}`

  if (!args.tab || args.tab === PUBLIC_PROFILE_DEFAULT_TAB) {
    return base
  }

  const params = new URLSearchParams({ tab: args.tab })
  return `${base}?${params.toString()}`
}

export function buildPublicProfileTabs(
  professionalId: string,
): Array<PublicProfileTabItem & { href: string }> {
  return PUBLIC_PROFILE_TABS.map((tab) => ({
    ...tab,
    href: buildProfessionalProfileHref({
      professionalId,
      tab: tab.id,
    }),
  }))
}

export function buildPublicProfileFromPath(args: {
  professionalId: string
  tab: PublicProfileTab
}): string {
  return buildProfessionalProfileHref({
    professionalId: args.professionalId,
    tab: args.tab,
  })
}

export function formatDisplayHandle(handle: string | null | undefined): string | null {
  const trimmed = trimToNull(handle)
  if (!trimmed) return null

  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`
}

/**
 * A client's PUBLIC handle (`@handle`) — but ONLY when they've opted into a
 * public profile. Never returns a legal name. Null when the profile is private
 * or has no handle, so callers fall back to a generic, name-free label. Mirrors
 * the activity-feed gate (`isPublicProfile && handle`) so social notifications
 * and the feed agree on when a stranger's identity may be shown.
 */
export function pickClientPublicHandle(input: {
  handle: string | null | undefined
  isPublicProfile: boolean | null | undefined
}): string | null {
  if (!input.isPublicProfile) return null
  return formatDisplayHandle(input.handle)
}

export function formatBusinessName(
  businessName: string | null | undefined,
): string | null {
  return trimToNull(businessName)
}

export function formatPublicProfileDisplayName(args: {
  businessName: string | null | undefined
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  nameDisplay?: ProNameDisplay | null
  fallback?: string
}): string {
  return formatProfessionalPublicDisplayName(args, args.fallback)
}

export function formatProfileLocation(
  location: string | null | undefined,
): string | null {
  return trimToNull(location)
}

export function formatProfileSubtitle(args: {
  professionType: ProfessionType | null | undefined
  location: string | null | undefined
}): string {
  const professionLabel = formatProfessionLabel(args.professionType)
  const location = formatProfileLocation(args.location)

  return location ? `${professionLabel} · ${location}` : professionLabel
}

export function formatBio(value: string | null | undefined): string | null {
  return trimToNull(value)
}

export function formatAvatarUrl(value: string | null | undefined): string | null {
  return trimToNull(value)
}

export function formatInitial(value: string | null | undefined): string {
  const trimmed = trimToNull(value)
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'P'
}

export function formatAverageRating(value: number | null | undefined): string | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null

  const normalized = Math.min(Math.max(value, 0), 5)

  return normalized.toFixed(1)
}

export function formatRatingCount(value: number | null | undefined): string {
  if (typeof value !== 'number') return '0'
  if (!Number.isFinite(value)) return '0'

  return String(Math.max(0, Math.trunc(value)))
}

export function formatReviewLabel(count: number | null | undefined): string {
  const normalized = typeof count === 'number' && Number.isFinite(count)
    ? Math.max(0, Math.trunc(count))
    : 0

  return normalized === 1 ? '1 review' : `${formatCompactCount(normalized)} reviews`
}

export function formatFollowerLabel(count: number | null | undefined): string {
  const normalized = typeof count === 'number' && Number.isFinite(count)
    ? Math.max(0, Math.trunc(count))
    : 0

  return normalized === 1
    ? '1 follower'
    : `${formatCompactCount(normalized)} followers`
}

export function formatDurationMinutes(value: number | null | undefined): string | null {
  if (typeof value !== 'number') return null
  if (!Number.isFinite(value)) return null

  const minutes = Math.max(0, Math.trunc(value))

  return `${minutes} min`
}

export function formatDateIso(value: Date): string {
  return value.toISOString()
}

export function formatClientName(
  input:
    | {
        firstName?: string | null
        lastName?: string | null
        email?: string | null
      }
    | null
    | undefined,
): string {
  if (!input) return 'Client'

  const firstName = trimToNull(input.firstName)
  const lastName = trimToNull(input.lastName)
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  if (fullName) return fullName

  return trimToNull(input.email) ?? 'Client'
}

/**
 * Public-facing reviewer name: first name + last initial ("Jane D."), the
 * convention for public reviews. Unlike formatClientName (used in the pro's own
 * authenticated client views), this NEVER exposes the full last name and NEVER
 * falls back to the reviewer's email — a reviewer on a public pro profile must
 * not be identifiable by full name or contact info. Falls back to a generic
 * label when no usable name is set.
 */
export function formatPublicReviewerName(input: {
  firstName?: string | null
  lastName?: string | null
}): string {
  const firstName = trimToNull(input.firstName)
  const lastName = trimToNull(input.lastName)
  const lastInitial = lastName ? `${lastName.charAt(0).toUpperCase()}.` : null

  if (firstName && lastInitial) return `${firstName} ${lastInitial}`
  if (firstName) return firstName

  return 'Client'
}

export function formatDisplayTimeZone(value: string | null | undefined): string | null {
  const timeZone = trimToNull(value)

  if (!timeZone) return null
  if (!isValidIanaTimeZone(timeZone)) return null

  return timeZone
}

export function formatPortfolioEmptyMessage(): string {
  return 'No portfolio posts yet.'
}

export function formatServicesEmptyMessage(): string {
  return 'No services listed yet.'
}

export function formatReviewsEmptyMessage(): string {
  return 'No reviews yet.'
}

export function getPublicProfileTabLabel(tab: PublicProfileTab): string {
  const match = PUBLIC_PROFILE_TABS.find((item) => item.id === tab)

  return match?.label ?? 'Portfolio'
}

/**
 * Tab labels carrying their own counts — "Portfolio · 200", "Reviews · 87".
 * A count is only appended when there is one to show; "Portfolio · 0" would
 * label an empty tab with the emptiness twice.
 */
export function buildPublicProfileTabLabels(counts: {
  portfolio: number
  services: number
  reviews: number
}): Record<PublicProfileTab, string> {
  const withCount = (tab: PublicProfileTab, count: number): string => {
    const label = getPublicProfileTabLabel(tab)
    return count > 0 ? `${label} · ${formatCompactCount(count)}` : label
  }

  return {
    portfolio: withCount('portfolio', counts.portfolio),
    services: withCount('services', counts.services),
    reviews: withCount('reviews', counts.reviews),
  }
}

export type PublicProfileBookBar = {
  headline: string
  subline: string
  ctaLabel: string
  inert: boolean
  footnote: string | null
}

/**
 * The book bar's copy. Pure so the pending / signed-out / priced branches are
 * unit-testable without a page render.
 *
 * 🔴 The CTA composes as "Book · From $85". `priceFromLabel` is a bare "$85"
 * (the "From" lives here, and in `formatPricingLine` for the stacked service
 * lines) — Tori's standing rule is that a price is a STARTING price, and the
 * one place the word must NOT be added is `formatMoneyLabel`, which feeds this
 * label and would then read "From From $85".
 */
export function buildPublicProfileBookBar(args: {
  isPendingVerification: boolean
  isSignedIn: boolean
  availabilityLine: string | null
  priceFromLabel: string | null
  cheapestServiceName: string | null
  serviceCount: number
}): PublicProfileBookBar {
  const copy = COPY.publicProfile

  if (args.isPendingVerification) {
    return {
      headline: copy.bookBarHeadlinePending,
      subline: copy.bookBarSublinePending,
      ctaLabel: copy.bookBarCtaPending,
      inert: true,
      footnote: copy.bookBarFootnotePending,
    }
  }

  const servicesWord =
    args.serviceCount === 1 ? copy.bookBarServicesOne : copy.bookBarServicesMany

  const priced =
    args.cheapestServiceName && args.priceFromLabel
      ? `${args.cheapestServiceName} ${copy.bookBarSublineFrom} ${args.priceFromLabel}`
      : null

  const subline =
    priced && args.serviceCount > 0
      ? `${priced} · ${args.serviceCount} ${servicesWord}`
      : (priced ?? copy.bookBarSublineNoPrice)

  return {
    // Availability leads when the pro has a fresh opening; otherwise the bar
    // says what it is rather than inventing urgency it can't evidence.
    headline: args.availabilityLine ?? copy.bookBarHeadlineFallback,
    subline,
    ctaLabel: args.priceFromLabel
      ? `${copy.bookBarCta}${copy.bookBarCtaPriceJoin}${args.priceFromLabel}`
      : copy.bookBarCta,
    inert: false,
    footnote: args.isSignedIn ? null : copy.bookBarFootnoteSignedOut,
  }
}
