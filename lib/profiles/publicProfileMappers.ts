// lib/profiles/publicProfileMappers.ts
import 'server-only'

import { MediaType } from '@prisma/client'
import type { MediaVisibility, ProfessionType, VerificationStatus } from '@prisma/client'

import { moneyToString } from '@/lib/money'
import { renderMediaUrls } from '@/lib/media/renderUrls'
import { pickString } from '@/lib/pick'
import {
  formatAvatarUrl,
  formatAverageRating,
  formatBio,
  formatBusinessName,
  formatClientName,
  formatCompactCount,
  formatDateIso,
  formatDisplayHandle,
  formatDisplayTimeZone,
  formatDurationMinutes,
  formatProfessionLabel,
  formatProfileLocation,
  formatPublicProfileDisplayName,
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
  displayName: string
  businessName: string | null
  bio: string | null
  avatarUrl: string | null
  professionType: ProfessionType | null
  professionLabel: string
  location: string | null
  timeZone: string | null
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
}

export type PublicPortfolioTileDto = {
  id: string
  caption: string | null
  src: string
  thumbUrl: string | null
  mediaType: MediaType
  isVideo: boolean
  visibility: MediaVisibility
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  serviceIds: string[]
}

export type PublicReviewMediaDto = {
  id: string
  url: string
  thumbUrl: string | null
  mediaType: MediaType
  isFeaturedInPortfolio: boolean
}

export type PublicReviewDto = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string
  clientName: string
  helpfulCount: number
  viewerHelpful: boolean
  mediaAssets: PublicReviewMediaDto[]
}

export type PublicProfileStatsDto = {
  priceFromLabel: string | null
  completedBookingsLabel: string
  favoritesLabel: string
  reviewCountLabel: string
  averageRatingLabel: string | null
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null
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

function formatPricingLine(candidate: OfferingPriceCandidate): string {
  const duration = formatDurationMinutes(candidate.durationMinutes)

  return duration
    ? `${candidate.label}: ${candidate.priceLabel} · ${duration}`
    : `${candidate.label}: ${candidate.priceLabel}`
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

async function renderAssetUrls(
  input: RenderableMediaInput,
): Promise<RenderedMediaUrls> {
  let url = pickString(input.url)
  let thumbUrl = pickString(input.thumbUrl)

  if ((!url || !thumbUrl) && hasStoragePointers(input)) {
    const rendered = await renderMediaUrls({
      storageBucket: input.storageBucket,
      storagePath: input.storagePath,
      thumbBucket: input.thumbBucket,
      thumbPath: input.thumbPath,
      url: input.url,
      thumbUrl: input.thumbUrl,
    })

    url = pickString(rendered.renderUrl) ?? url
    thumbUrl = pickString(rendered.renderThumbUrl) ?? thumbUrl
  }

  return {
    url,
    thumbUrl,
  }
}

export function mapPublicProfileHeaderToDto(
  profile: PublicProfessionalProfileRow,
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
    displayName: formatPublicProfileDisplayName({
      businessName,
    }),
    businessName,
    bio: formatBio(profile.bio),
    avatarUrl: formatAvatarUrl(profile.avatarUrl),
    professionType: profile.professionType,
    professionLabel: formatProfessionLabel(profile.professionType),
    location: formatProfileLocation(profile.location),
    timeZone: formatDisplayTimeZone(profile.timeZone),
  }
}

export function formatOfferingPricing(offering: PublicOfferingRow): string[] {
  return getOfferingPriceCandidates(offering).map(formatPricingLine)
}

export function mapPublicOfferingToDto(
  offering: PublicOfferingRow,
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
  }
}

export function mapPublicOfferingsToDtos(
  offerings: PublicOfferingRow[],
): PublicOfferingDto[] {
  return offerings
    .filter((offering) => offering.isActive)
    .map((offering) => mapPublicOfferingToDto(offering))
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
): Promise<PublicPortfolioTileDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: asset.storageBucket,
    storagePath: asset.storagePath,
    thumbBucket: asset.thumbBucket,
    thumbPath: asset.thumbPath,
    url: asset.url,
    thumbUrl: asset.thumbUrl,
  })

  const src = rendered.thumbUrl ?? rendered.url
  if (!src) return null

  return {
    id: asset.id,
    caption: pickString(asset.caption),
    src,
    thumbUrl: rendered.thumbUrl,
    mediaType: asset.mediaType,
    isVideo: asset.mediaType === MediaType.VIDEO,
    visibility: asset.visibility,
    isEligibleForLooks: asset.isEligibleForLooks,
    isFeaturedInPortfolio: asset.isFeaturedInPortfolio,
    serviceIds: pickServiceIds(asset.services),
  }
}

export async function mapPublicPortfolioTilesToDtos(
  assets: PublicPortfolioMediaAssetRow[],
): Promise<PublicPortfolioTileDto[]> {
  const tiles = await Promise.all(
    assets.map((asset) => mapPublicPortfolioTileToDto(asset)),
  )

  return tiles.filter(isNonNull)
}

export async function mapPublicReviewMediaAssetToDto(
  asset: PublicReviewMediaAssetRow,
): Promise<PublicReviewMediaDto | null> {
  const rendered = await renderAssetUrls({
    storageBucket: asset.storageBucket,
    storagePath: asset.storagePath,
    thumbBucket: asset.thumbBucket,
    thumbPath: asset.thumbPath,
    url: asset.url,
    thumbUrl: asset.thumbUrl,
  })

  if (!rendered.url) return null

  return {
    id: asset.id,
    url: rendered.url,
    thumbUrl: rendered.thumbUrl,
    mediaType: asset.mediaType,
    isFeaturedInPortfolio: asset.isFeaturedInPortfolio,
  }
}

export async function mapPublicReviewToDto(args: {
  review: PublicReviewRow
  viewerHelpfulReviewIds?: ReadonlySet<string>
}): Promise<PublicReviewDto> {
  const { review, viewerHelpfulReviewIds } = args

  const mediaAssets = await Promise.all(
    review.mediaAssets.map((asset) => mapPublicReviewMediaAssetToDto(asset)),
  )

  return {
    id: review.id,
    rating: review.rating,
    headline: pickString(review.headline),
    body: pickString(review.body),
    createdAt: formatDateIso(review.createdAt),
    clientName: formatClientName({
      firstName: review.client?.firstName ?? null,
      lastName: review.client?.lastName ?? null,
      email: review.client?.user?.email ?? null,
    }),
    helpfulCount: review.helpfulCount ?? 0,
    viewerHelpful: viewerHelpfulReviewIds?.has(review.id) ?? false,
    mediaAssets: mediaAssets.filter(isNonNull),
  }
}

export async function mapPublicReviewsToDtos(args: {
  reviews: PublicReviewRow[]
  viewerHelpfulReviewIds?: ReadonlySet<string>
}): Promise<PublicReviewDto[]> {
  const { reviews, viewerHelpfulReviewIds } = args

  return Promise.all(
    reviews.map((review) =>
      mapPublicReviewToDto({
        review,
        viewerHelpfulReviewIds,
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
}): PublicProfileStatsDto {
  return {
    priceFromLabel: getPublicProfilePriceFromLabel(args.offerings),
    completedBookingsLabel: formatCompactCount(args.completedBookingCount),
    favoritesLabel: formatCompactCount(args.favoritesCount),
    reviewCountLabel: formatCompactCount(args.reviewCount),
    averageRatingLabel: formatAverageRating(args.averageRating),
  }
}