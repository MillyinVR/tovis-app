// lib/profiles/publicProfileMappers.ts
import 'server-only'

import { MediaType, VerificationStatus } from '@prisma/client'
import type { MediaVisibility, ProfessionType } from '@prisma/client'

import { isNonNull } from '@/lib/guards'
import { moneyToString } from '@/lib/money'
import { isProCurrentlyLicensed } from '@/lib/licensing/currentlyLicensed'
import {
  mapPairedBeforeToDto,
  type PairedBeforeDto,
} from '@/lib/media/pairedBefore'
import type { ImageVariant } from '@/lib/media/imageTransform'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { pickString } from '@/lib/pick'
import {
  EMPTY_CLIENT_LINK_VIEWER,
  resolveClientProfileHref,
  type ClientLinkViewer,
} from '@/lib/profiles/profileHrefs'
import { formatCompactCount } from '@/lib/format/compactCount'
import {
  formatAvatarUrl,
  formatAverageRating,
  formatBio,
  formatBusinessName,
  formatDateIso,
  formatDisplayHandle,
  formatDisplayTimeZone,
  formatDurationMinutes,
  formatProfessionLabel,
  formatProfileLocation,
  formatPublicProfileDisplayName,
  formatPublicReviewerName,
} from '@/lib/profiles/publicProfileFormatting'
import type {
  PublicOfferingRow,
  PublicPortfolioMediaAssetRow,
  PublicProfessionalProfileRow,
  PublicReviewMediaAssetRow,
  PublicReviewRow,
} from '@/lib/profiles/publicProfileSelects'

type RenderableMediaInput = {
  storageBucket: string | null
  storagePath: string | null
  thumbBucket: string | null
  thumbPath: string | null
  url: string | null
  thumbUrl: string | null
}

type RenderedMediaUrls = {
  url: string | null
  thumbUrl: string | null
}

type OfferingLocationType = 'SALON' | 'MOBILE'

type OfferingMoneyValue =
  | PublicOfferingRow['salonPriceStartingAt']
  | PublicOfferingRow['mobilePriceStartingAt']

type OfferingPriceCandidate = {
  locationType: OfferingLocationType
  label: string
  priceLabel: string
  priceNumber: number
  durationMinutes: number | null
}

export type PublicProfileHeaderDto = {
  id: string
  userId: string
  verificationStatus: VerificationStatus
  handle: string | null
  displayHandle: string | null
  isPremium: boolean
  // Whether a CLIENT may export/share this pro's media with the pro's handle
  // watermarked on it — the pro's own opt-out (clientMediaExportEnabled) plus
  // whether their plan drops the platform mark (mirrors exportsDropPlatformMark
  // on /pro/membership/status, resolved here so a client-facing read never needs
  // the pro-authed endpoint). Read by tovis-ios's client media export flow.
  clientExport: { enabled: boolean; dropsPlatformMark: boolean }
  // True only for an approved pro whose profession actually requires a license
  // and whose license is verified — avoids a false "license verified" badge on
  // exempt professions (e.g. makeup artists) that approval also marks verified.
  isLicenseVerified: boolean
  displayName: string
  businessName: string | null
  bio: string | null
  avatarUrl: string | null
  // Creator-page cover banner (§18): a pro-chosen portfolio photo shown behind
  // the identity block, or null when unset (the profile then renders a branded
  // fallback, never the stretched avatar). Rendered URL, resolved by the loader.
  coverUrl: string | null
  professionType: ProfessionType | null
  professionLabel: string
  location: string | null
  timeZone: string | null
  // Public social presence (handles stored without "@").
  instagramHandle: string | null
  tiktokHandle: string | null
  websiteUrl: string | null
}

export type PublicOfferingDto = {
  id: string
  professionalId: string
  serviceId: string
  name: string
  description: string | null
  imageUrl: string | null
  pricingLines: string[]
  priceFromLabel: string | null
  priceFromNumber: number | null
  durationMinutes: number | null
  offersInSalon: boolean
  offersMobile: boolean
  // Whether the current viewer has saved this offering's underlying service.
  // Always false for guests / non-client viewers.
  isFavorited: boolean
}

// The before/after pairing mapper lives in lib/media (a media concept shared by
// the portfolio and review mappers). Re-exported here so existing importers keep
// their import path.
export { mapPairedBeforeToDto }
export type { PairedBeforeDto }

/**
 * The three engagement numbers a redesigned grid tile prints. `likeCount` and
 * `commentCount` are the denormalized counters on `LookPost` (the same ones the
 * looks feed renders via `LooksCountsDto`); `recreatedCount` is non-cancelled
 * bookings citing the look as their source — the loader reads all of them for
 * the whole grid in one grouped query, never per tile.
 */
export type PublicPortfolioTileEngagement = {
  likeCount: number
  commentCount: number
  recreatedCount: number
}

const EMPTY_TILE_ENGAGEMENT: PublicPortfolioTileEngagement = {
  likeCount: 0,
  commentCount: 0,
  recreatedCount: 0,
}

function normalizeCount(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

export type PublicPortfolioTileDto = {
  id: string
  // §19f — the backing `LookPost` id (the grid reads LookPosts since §19c), so the
  // tile links to `/looks/[lookId]` (the feed detail with engagement) instead of the
  // media page — mirroring the `/u/[handle]` client grid. Null on the rare legacy
  // path where a tile isn't backed by a look; the grid then falls back to /media.
  lookId: string | null
  caption: string | null
  src: string
  thumbUrl: string | null
  mediaType: MediaType
  isVideo: boolean
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  serviceIds: string[]
  /**
   * Display names for `serviceIds`, in the same tag order. Native clients render
   * these as the tile's service chips (web's `/media/[id]` resolves the same
   * names server-side); empty when the media carries no service tags.
   */
  serviceNames: string[]
  /**
   * The subject focal point (camera C6) of `src`, [0,1] from the top-left, or
   * null for center. Every profile surface cover-crops this tile to a different
   * frame (a 3:4 grid cell, a 4:5 Signature card), so each one needs the focal
   * to place its window on the face rather than the geometric middle.
   */
  focalX: number | null
  focalY: number | null
  /**
   * The non-destructive publish CROP (capture chain item 2): the rect of `src`
   * a surface should display, [0,1] from the top-left, in the SAME space as the
   * focal above. All four or all null; null = the full stored frame, which is
   * every tile today. It rides the wire so the future re-frame editor and the
   * native tiles can adopt it without another schema round — nothing renders it
   * yet. 🔴 A surface that DOES honor the rect must also remap the focal into
   * crop space (`lib/media/cropRect.ts` → `focalInCropSpace`): the focal is
   * measured on the UNCROPPED frame, so using it raw inside a crop silently
   * mis-centers the window.
   */
  cropX: number | null
  cropY: number | null
  cropW: number | null
  cropH: number | null
  before: PairedBeforeDto | null
  /**
   * Likes, comments and "N recreated this" for the backing look. Always present
   * (zeroed when the tile has no look); a caller renders a zero as NOTHING, never
   * as a literal "0" — an empty grid tile is quieter than one advertising no
   * engagement.
   */
  engagement: PublicPortfolioTileEngagement
}

/**
 * The pro's SIGNATURE post — one optional, pro-chosen piece of their own work,
 * promoted above the grid (client walkthrough screen 6). It is the SAME tile the
 * grid would have rendered plus the two things the promoted treatment adds: the
 * starting price for the service it shows, and a way to book that exact look.
 *
 * 🔴 Never label this "Spotlight" or "Featured" on any surface — see the
 * `signatureMediaAssetId` comment in prisma/schema.prisma. `LookPost.featuredAt`
 * is a SUPER_ADMIN editorial pick and must keep the word to itself.
 */
export type PublicProfileSignatureDto = {
  tile: PublicPortfolioTileDto
  /**
   * Already composed as "Salon: From $250 · 180 min" by `formatPricingLine`, so
   * it can never render a bare figure (Tori's standing rule). Null when the look
   * carries no service, or the pro has no active offering for it.
   */
  priceLine: string | null
  /** Opens the look with its availability drawer already open; null with no look. */
  bookHref: string | null
}

export type PublicReviewMediaDto = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  isFeaturedInPortfolio: boolean
  /** Paired "before" for the comparison slider, or null when not paired. */
  before: PairedBeforeDto | null
}

export type PublicReviewDto = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  clientName: string
  // Link to the reviewer's /u/[handle] profile, or null when they have no public
  // creator identity (keeps the reviewer's name PII-safe and unlinked).
  clientHref: string | null
  helpfulCount: number
  viewerHelpful: boolean
  mediaAssets: PublicReviewMediaDto[]
  // The pro's single public response, or null when they haven't replied.
  proReply: PublicReviewProReplyDto | null
}

export type PublicReviewProReplyDto = {
  body: string
  repliedAt: string
}

export type PublicProfileStatsDto = {
  priceFromLabel: string | null
  completedBookingsLabel: string
  favoritesLabel: string
  reviewCountLabel: string
  averageRatingLabel: string | null
  // Raw ProFollow count (index-backed) — the Follow button needs a number it
  // can nudge optimistically, so this stays unformatted unlike the labels.
  followerCount: number
  // The pro-owner stats grid (web /pro/profile/public-profile, iOS
  // ProProfileTabView) reports published looks and followers as static tiles.
  // Formatted here, like the labels above, so the two clients can't drift into
  // separate compact-count implementations; `followerCount` above stays raw for
  // the Follow button, which is a different surface with live mutation.
  looksLabel: string
  followersLabel: string
}

function hasStoragePointers(
  input: RenderableMediaInput,
): input is RenderableMediaInput & {
  storageBucket: string
  storagePath: string
} {
  return Boolean(pickString(input.storageBucket) && pickString(input.storagePath))
}

function formatMoneyLabel(value: OfferingMoneyValue): string | null {
  const amount = moneyToString(value)

  return amount ? `$${amount}` : null
}

function moneyToComparableNumber(value: OfferingMoneyValue): number | null {
  const amount = moneyToString(value)
  if (!amount) return null

  const parsed = Number(amount)

  return Number.isFinite(parsed) ? parsed : null
}

function getOfferingPriceCandidates(
  offering: PublicOfferingRow,
): OfferingPriceCandidate[] {
  const candidates: OfferingPriceCandidate[] = []

  const salonPriceLabel = formatMoneyLabel(offering.salonPriceStartingAt)
  const salonPriceNumber = moneyToComparableNumber(offering.salonPriceStartingAt)

  if (offering.offersInSalon && salonPriceLabel && salonPriceNumber !== null) {
    candidates.push({
      locationType: 'SALON',
      label: 'Salon',
      priceLabel: salonPriceLabel,
      priceNumber: salonPriceNumber,
      durationMinutes: offering.salonDurationMinutes ?? null,
    })
  }

  const mobilePriceLabel = formatMoneyLabel(offering.mobilePriceStartingAt)
  const mobilePriceNumber = moneyToComparableNumber(offering.mobilePriceStartingAt)

  if (offering.offersMobile && mobilePriceLabel && mobilePriceNumber !== null) {
    candidates.push({
      locationType: 'MOBILE',
      label: 'Mobile',
      priceLabel: mobilePriceLabel,
      priceNumber: mobilePriceNumber,
      durationMinutes: offering.mobileDurationMinutes ?? null,
    })
  }

  return candidates
}

function pickLowestPriceCandidate(
  offering: PublicOfferingRow,
): OfferingPriceCandidate | null {
  const candidates = getOfferingPriceCandidates(offering)

  if (candidates.length === 0) return null

  return candidates.reduce((best, candidate) =>
    candidate.priceNumber < best.priceNumber ? candidate : best,
  )
}

/**
 * 🔴 Tori's standing rule: a price is a STARTING price. The source field is
 * `salonPriceStartingAt` / `mobilePriceStartingAt` — the pro sets the final
 * number at the chair — so this line must never render a bare figure.
 *
 * The word is added HERE and not in `formatMoneyLabel`, because that helper also
 * feeds `priceFromLabel`, which both clients render under their own "From"
 * label (web `<ProfileHeroStat label="From">`, iOS `statCell("From", …)`).
 * Prefixing there would read "From From $250" on web's hero stat.
 */
function formatPricingLine(candidate: OfferingPriceCandidate): string {
  const duration = formatDurationMinutes(candidate.durationMinutes)
  const price = `From ${candidate.priceLabel}`

  return duration
    ? `${candidate.label}: ${price} · ${duration}`
    : `${candidate.label}: ${price}`
}

function pickOfferingName(offering: PublicOfferingRow): string {
  return (
    pickString(offering.title) ??
    pickString(offering.service.name) ??
    'Service'
  )
}

function pickOfferingImage(offering: PublicOfferingRow): string | null {
  return (
    pickString(offering.customImageUrl) ??
    pickString(offering.service.defaultImageUrl)
  )
}

function pickServiceIds(
  services: PublicPortfolioMediaAssetRow['services'],
): string[] {
  const ids = new Set<string>()

  for (const serviceTag of services) {
    const serviceId = pickString(serviceTag.serviceId)
    if (serviceId) ids.add(serviceId)
  }

  return [...ids]
}

/**
 * Display names for a media asset's service tags — trimmed, blank-dropped and
 * de-duplicated, in tag order. Shared by the portfolio tile DTO and the
 * `/media/[id]` page so the two surfaces can never disagree about which chips
 * a piece of media shows.
 */
export function pickServiceTagNames(
  services: ReadonlyArray<{ service: { name: string } }>,
): string[] {
  const names = new Set<string>()

  for (const serviceTag of services) {
    const name = pickString(serviceTag.service.name)
    if (name) names.add(name)
  }

  return [...names]
}

/**
 * `variant` is REQUIRED, not optional: no asset in the database has a stored
 * thumb, so a caller that omits one silently serves the multi-megabyte stored
 * original. See `lib/media/imageTransform.ts`.
 */
async function renderAssetUrls(
  input: RenderableMediaInput,
  variant: ImageVariant,
): Promise<RenderedMediaUrls> {
  let url = pickString(input.url)
  let thumbUrl = pickString(input.thumbUrl)

  if ((!url || !thumbUrl) && hasStoragePointers(input)) {
    const rendered = await renderMediaUrls(
      {
        storageBucket: input.storageBucket,
        storagePath: input.storagePath,
        thumbBucket: input.thumbBucket,
        thumbPath: input.thumbPath,
        url: input.url,
        thumbUrl: input.thumbUrl,
      },
      { variant },
    )

    url = pickString(rendered.renderUrl) ?? url
    thumbUrl = pickString(rendered.renderThumbUrl) ?? thumbUrl
  }

  return {
    url,
    thumbUrl,
  }
}

/**
 * Resolves the display URL for a pro's cover banner (§18) from its render
 * pointers, or null when no cover is set. Kept separate from the (sync) header
 * mapper so the SEO/JSON-LD path — which never needs the cover — pays nothing;
 * the profile loader awaits this and passes the result into the mapper.
 */
export async function renderPublicProfileCoverUrl(
  profile: Pick<PublicProfessionalProfileRow, 'coverMediaAsset'>,
): Promise<string | null> {
  const cover = profile.coverMediaAsset
  if (!cover) return null

  const rendered = await renderAssetUrls(
    {
      storageBucket: cover.storageBucket,
      storagePath: cover.storagePath,
      thumbBucket: cover.thumbBucket,
      thumbPath: cover.thumbPath,
      url: cover.url,
      thumbUrl: cover.thumbUrl,
    },
    // A full-width banner, not a cell. ⚠️ Only reached as a fallback: the
    // return below prefers the full-size render.
    'feed',
  )

  // Prefer the full-size render for a banner; fall back to the thumb.
  return rendered.url ?? rendered.thumbUrl
}

/**
 * 🔴 Both trailing arguments are REQUIRED on purpose — neither may be defaulted.
 *
 * `dropsPlatformMark` used to default to `true`, from a time when every pro's
 * exports were unbranded and the mark was cosmetic. It is now a paid perk that
 * `exportsDropPlatformMark` gates on the entitlement ALONE, independently of
 * ENABLE_MEMBERSHIP_ENFORCEMENT (see `lib/pro/socialExportMark.ts`, decided
 * 2026-08-20). A default therefore GRANTS that perk to whoever forgets the
 * argument, which is exactly the accident the resolver dropped its own flag
 * parameter to prevent. Callers resolve the entitlement and say so.
 *
 * `coverUrl` follows for the same reason in miniature: a silent `null` reads as
 * "this pro has no cover photo" rather than "the caller didn't ask".
 */
export function mapPublicProfileHeaderToDto(
  profile: PublicProfessionalProfileRow,
  coverUrl: string | null,
  dropsPlatformMark: boolean,
): PublicProfileHeaderDto {
  const businessName = formatBusinessName(profile.businessName)
  const handle = pickString(profile.handle)

  return {
    id: profile.id,
    userId: profile.userId,
    verificationStatus: profile.verificationStatus,
    handle,
    displayHandle: formatDisplayHandle(handle),
    isPremium: profile.isPremium,
    clientExport: {
      enabled: profile.clientMediaExportEnabled,
      dropsPlatformMark,
    },
    isLicenseVerified: isProCurrentlyLicensed(profile),
    displayName: formatPublicProfileDisplayName({
      businessName,
      firstName: profile.firstName,
      lastName: profile.lastName,
      handle,
      nameDisplay: profile.nameDisplay,
    }),
    businessName,
    bio: formatBio(profile.bio),
    avatarUrl: formatAvatarUrl(profile.avatarUrl),
    coverUrl,
    professionType: profile.professionType,
    professionLabel: formatProfessionLabel(profile.professionType),
    location: formatProfileLocation(profile.location),
    timeZone: formatDisplayTimeZone(profile.timeZone),
    instagramHandle: pickString(profile.instagramHandle),
    tiktokHandle: pickString(profile.tiktokHandle),
    websiteUrl: pickString(profile.websiteUrl),
  }
}

export function formatOfferingPricing(offering: PublicOfferingRow): string[] {
  return getOfferingPriceCandidates(offering).map(formatPricingLine)
}

/**
 * The single pricing line for an offering's CHEAPEST mode — the same candidate
 * `priceFromLabel` reports, rendered in the full "Salon: From $250 · 180 min"
 * form. For surfaces where one line has to stand for the whole offering (the
 * Signature block), so the promoted price can never disagree with the "From"
 * figure elsewhere on the page.
 */
export function formatOfferingLowestPricingLine(
  offering: PublicOfferingRow,
): string | null {
  const lowest = pickLowestPriceCandidate(offering)

  return lowest ? formatPricingLine(lowest) : null
}

export function mapPublicOfferingToDto(
  offering: PublicOfferingRow,
  favoritedServiceIds?: ReadonlySet<string>,
): PublicOfferingDto {
  const lowestPrice = pickLowestPriceCandidate(offering)

  return {
    id: offering.id,
    professionalId: offering.professionalId,
    serviceId: offering.serviceId,
    name: pickOfferingName(offering),
    description: pickString(offering.description),
    imageUrl: pickOfferingImage(offering),
    pricingLines: formatOfferingPricing(offering),
    priceFromLabel: lowestPrice?.priceLabel ?? null,
    priceFromNumber: lowestPrice?.priceNumber ?? null,
    durationMinutes: lowestPrice?.durationMinutes ?? null,
    offersInSalon: offering.offersInSalon,
    offersMobile: offering.offersMobile,
    isFavorited: favoritedServiceIds?.has(offering.serviceId) ?? false,
  }
}

export function mapPublicOfferingsToDtos(
  offerings: PublicOfferingRow[],
  favoritedServiceIds?: ReadonlySet<string>,
): PublicOfferingDto[] {
  return offerings
    .filter((offering) => offering.isActive)
    .map((offering) => mapPublicOfferingToDto(offering, favoritedServiceIds))
}

export function getPublicProfilePriceFromLabel(
  offerings: PublicOfferingRow[],
): string | null {
  const candidates = offerings
    .filter((offering) => offering.isActive)
    .flatMap((offering) => getOfferingPriceCandidates(offering))

  if (candidates.length === 0) return null

  const lowest = candidates.reduce((best, candidate) =>
    candidate.priceNumber < best.priceNumber ? candidate : best,
  )

  return lowest.priceLabel
}


export async function mapPublicPortfolioTileToDto(
  asset: PublicPortfolioMediaAssetRow,
  lookId: string | null = null,
  engagement: PublicPortfolioTileEngagement = EMPTY_TILE_ENGAGEMENT,
): Promise<PublicPortfolioTileDto | null> {
  const rendered = await renderAssetUrls(
    {
      storageBucket: asset.storageBucket,
      storagePath: asset.storagePath,
      thumbBucket: asset.thumbBucket,
      thumbPath: asset.thumbPath,
      url: asset.url,
      thumbUrl: asset.thumbUrl,
    },
    'tile',
  )

  const src = rendered.thumbUrl ?? rendered.url
  if (!src) return null

  // A featured video can't be a before/after "after"; the mapper drops the
  // pairing for non-image afters too.
  const before =
    asset.mediaType === MediaType.IMAGE
      ? await mapPairedBeforeToDto(asset.beforeAsset, 'tile')
      : null

  return {
    id: asset.id,
    lookId,
    caption: pickString(asset.caption),
    src,
    thumbUrl: rendered.thumbUrl,
    mediaType: asset.mediaType,
    isVideo: asset.mediaType === MediaType.VIDEO,
    visibility: asset.visibility,
    isEligibleForLooks: asset.isEligibleForLooks,
    isFeaturedInPortfolio: asset.isFeaturedInPortfolio,
    serviceIds: pickServiceIds(asset.services),
    serviceNames: pickServiceTagNames(asset.services),
    focalX: asset.focalX ?? null,
    focalY: asset.focalY ?? null,
    cropX: asset.cropX ?? null,
    cropY: asset.cropY ?? null,
    cropW: asset.cropW ?? null,
    cropH: asset.cropH ?? null,
    before,
    engagement: {
      likeCount: normalizeCount(engagement.likeCount),
      commentCount: normalizeCount(engagement.commentCount),
      recreatedCount: normalizeCount(engagement.recreatedCount),
    },
  }
}

/**
 * Maps portfolio tiles from the pro's `LookPost`s (§19c read path). Each entry
 * carries the look id so the tile can link to `/looks/[lookId]` (§19f), and its
 * engagement counts so the grid can print them without a per-tile read.
 */
export async function mapPublicPortfolioTilesToDtos(
  looks: Array<{
    lookId: string | null
    asset: PublicPortfolioMediaAssetRow
    engagement?: PublicPortfolioTileEngagement
  }>,
): Promise<PublicPortfolioTileDto[]> {
  const tiles = await Promise.all(
    looks.map((look) =>
      mapPublicPortfolioTileToDto(look.asset, look.lookId, look.engagement),
    ),
  )

  return tiles.filter(isNonNull)
}

/**
 * Maps the pro's chosen SIGNATURE post. Returns null when the tile itself can't
 * render (no usable image), so the caller simply omits the block rather than
 * drawing an empty promoted card.
 */
export async function mapPublicProfileSignatureToDto(args: {
  lookId: string
  asset: PublicPortfolioMediaAssetRow
  engagement: PublicPortfolioTileEngagement
  priceLine: string | null
}): Promise<PublicProfileSignatureDto | null> {
  const tile = await mapPublicPortfolioTileToDto(
    args.asset,
    args.lookId,
    args.engagement,
  )

  if (!tile) return null

  return {
    tile,
    priceLine: args.priceLine,
    // The same `?book=1` contract screen 2's "Recreate this look" uses, so the
    // appointment inherits the picture that prompted it on both platforms.
    bookHref: `/looks/${encodeURIComponent(args.lookId)}?book=1`,
  }
}

export async function mapPublicReviewMediaAssetToDto(
  asset: PublicReviewMediaAssetRow,
): Promise<PublicReviewMediaDto | null> {
  const rendered = await renderAssetUrls(
    {
      storageBucket: asset.storageBucket,
      storagePath: asset.storagePath,
      thumbBucket: asset.thumbBucket,
      thumbPath: asset.thumbPath,
      url: asset.url,
      thumbUrl: asset.thumbUrl,
    },
    'tile',
  )

  if (!rendered.url) return null

  // Only an image "after" carries a before/after pairing (parity with portfolio).
  const before =
    asset.mediaType === MediaType.IMAGE
      ? await mapPairedBeforeToDto(asset.beforeAsset, 'tile')
      : null

  return {
    id: asset.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: asset.mediaType,
    isFeaturedInPortfolio: asset.isFeaturedInPortfolio,
    before,
  }
}

export async function mapPublicReviewToDto(args: {
  review: PublicReviewRow
  viewerHelpfulReviewIds?: ReadonlySet<string>
  clientLinkViewer?: ClientLinkViewer
}): Promise<PublicReviewDto> {
  const { review, viewerHelpfulReviewIds, clientLinkViewer } = args

  const mediaAssets = await Promise.all(
    review.mediaAssets.map((asset) => mapPublicReviewMediaAssetToDto(asset)),
  )

  return {
    id: review.id,
    rating: review.rating,
    headline: pickString(review.headline),
    body: pickString(review.body),
    createdAt: formatDateIso(review.createdAt),
    clientName: formatPublicReviewerName({
      firstName: review.client?.firstName ?? null,
      lastName: review.client?.lastName ?? null,
    }),
    clientHref: review.client
      ? resolveClientProfileHref(
          {
            clientProfileId: review.client.id,
            handle: review.client.handle,
            isPublicProfile: review.client.isPublicProfile,
          },
          clientLinkViewer ?? EMPTY_CLIENT_LINK_VIEWER,
        )
      : null,
    helpfulCount: review.helpfulCount ?? 0,
    viewerHelpful: viewerHelpfulReviewIds?.has(review.id) ?? false,
    mediaAssets: mediaAssets.filter(isNonNull),
    proReply:
      review.proReplyBody && review.proReplyAt
        ? {
            body: review.proReplyBody,
            repliedAt: formatDateIso(review.proReplyAt),
          }
        : null,
  }
}

export async function mapPublicReviewsToDtos(args: {
  reviews: PublicReviewRow[]
  viewerHelpfulReviewIds?: ReadonlySet<string>
  clientLinkViewer?: ClientLinkViewer
}): Promise<PublicReviewDto[]> {
  const { reviews, viewerHelpfulReviewIds, clientLinkViewer } = args

  return Promise.all(
    reviews.map((review) =>
      mapPublicReviewToDto({
        review,
        viewerHelpfulReviewIds,
        clientLinkViewer,
      }),
    ),
  )
}

export function mapPublicProfileStatsToDto(args: {
  offerings: PublicOfferingRow[]
  completedBookingCount: number
  favoritesCount: number
  reviewCount: number
  averageRating: number | null
  followerCount: number
  publishedLooksCount: number
}): PublicProfileStatsDto {
  return {
    priceFromLabel: getPublicProfilePriceFromLabel(args.offerings),
    completedBookingsLabel: formatCompactCount(args.completedBookingCount),
    favoritesLabel: formatCompactCount(args.favoritesCount),
    reviewCountLabel: formatCompactCount(args.reviewCount),
    averageRatingLabel: formatAverageRating(args.averageRating),
    followerCount: Math.max(0, Math.trunc(args.followerCount)),
    looksLabel: formatCompactCount(args.publishedLooksCount),
    followersLabel: formatCompactCount(args.followerCount),
  }
}