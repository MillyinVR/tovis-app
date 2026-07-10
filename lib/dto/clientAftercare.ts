// lib/dto/clientAftercare.ts
//
// Wire contract for GET /api/v1/client/bookings/[id]/aftercare — the client's
// read of their own aftercare: care notes (only once the pro has SENT the
// summary), the primary before/after pair the pro featured, and the pro's
// product recommendations (with the client's current booking-checkout
// selection). Powers the native client aftercare render (iOS BookingDetailView),
// matching the web booking-detail aftercare tab. The web page renders this in a
// server component; this endpoint exposes the same data to non-web clients.
//
// The before/after pair is the shared SSOT `BookingBeforeAfterThumbs`
// (pro-chosen featured pair, else earliest-per-phase) — the same shape the
// client home aftercare action card already carries.

import type {
  AftercareRebookMode,
  BookingCheckoutStatus,
  BookingStatus,
  MediaType,
  Prisma,
} from '@prisma/client'

import { isClientAftercareVisible } from '@/lib/aftercare/aftercareVisibility'
import { clientCanEditBookingCheckoutProducts } from '@/lib/booking/checkoutProductsEditable'
import { isBookingReviewEligible } from '@/lib/booking/closeoutState'
import type { BookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'
import { moneyToString } from '@/lib/money'

/** The care-notes slice of a SENT aftercare summary the client may read. */
export type ClientAftercareSummaryDTO = {
  id: string
  /** Free-text care instructions the pro wrote for the client. */
  notes: string | null
  /** ISO instant the pro sent this aftercare to the client. */
  sentToClientAt: string | null
}

/**
 * One product the pro recommended in the aftercare summary. Internal
 * recommendations (`productId` + `product` set) can be added to the booking
 * checkout; external ones (`externalName`/`externalUrl`) are link-outs only.
 * Mirrors the web `AftercareProductRecommendationsCard` recommendation shape.
 */
export type ClientAftercareRecommendedProductDTO = {
  id: string
  /** The internal Product id when this is an in-app recommendation, else null. */
  productId: string | null
  /** Optional free-text note the pro attached to the recommendation. */
  note: string | null
  /** Display name for an external (link-out) recommendation, else null. */
  externalName: string | null
  /** Link target for an external recommendation, else null. */
  externalUrl: string | null
  /** The internal product (name/brand/price), or null for external recs. */
  product: {
    id: string
    name: string
    brand: string | null
    /** Decimal-string retail price (per the wire money convention), or null. */
    retailPrice: string | null
  } | null
}

/**
 * The client's current booking-checkout product selection — one line per
 * recommendation they've added, with the snapshotted unit price. Mirrors
 * `BookingCheckoutProductItem`.
 */
export type ClientAftercareCheckoutProductDTO = {
  recommendationId: string
  productId: string
  quantity: number
  /** Decimal-string unit price snapshot (per the wire money convention). */
  unitPrice: string | null
}

/**
 * The AFTERCARE-sourced next booking coupled to this booking (its
 * `rebookOfBookingId` points back here). Lets the aftercare rebook card show a
 * confirmed / pending-approval state instead of re-offering Confirm. Mirrors the
 * web `rebookedNextBooking` load.
 */
export type ClientAftercareNextBookingDTO = {
  id: string
  /** The next booking's lifecycle status (PENDING until the pro approves, etc.). */
  status: BookingStatus
  /** Scheduled instant (ISO), or null when unset. */
  scheduledFor: string | null
}

/**
 * The pro's rebook recommendation from the sent aftercare summary + the coupled
 * next booking (if the client has already rebooked). Mirrors the web page's
 * `getAftercareRebookInfo` inputs (`aftercareSummarySelect` rebook fields) plus
 * the `rebookedNextBooking` load — powers the native rebook-window card. Present
 * only when a summary has been sent (same gate as `aftercare`).
 */
export type ClientAftercareRebookDTO = {
  /**
   * The pro's rebook mode: `NONE` (no recommendation), `RECOMMENDED_WINDOW` (a
   * date range the client picks within), or `BOOKED_NEXT_APPOINTMENT` (a specific
   * time the pro proposed for the client to confirm/decline).
   */
  mode: AftercareRebookMode
  /**
   * The pro-proposed next-appointment instant for `BOOKED_NEXT_APPOINTMENT`
   * (ISO), else null. Not set for `RECOMMENDED_WINDOW`.
   */
  rebookedFor: string | null
  /** Recommended-window start (ISO) for `RECOMMENDED_WINDOW`, else null. */
  windowStart: string | null
  /** Recommended-window end (ISO) for `RECOMMENDED_WINDOW`, else null. */
  windowEnd: string | null
  /**
   * ISO instant the client declined the pro's proposed `BOOKED_NEXT_APPOINTMENT`,
   * else null. Cleared when the pro re-offers.
   */
  declinedAt: string | null
  /**
   * The coupled AFTERCARE-sourced next booking when one exists (the client has
   * confirmed/booked), else null.
   */
  nextBooking: ClientAftercareNextBookingDTO | null
}

/**
 * One photo/video attached to the client's review, with render-ready URLs.
 * Review media lives in the public bucket (visibility PUBLIC — attaching to a
 * review is the publish-consent action); the URLs are resolved the same way the
 * web booking-detail page resolves the review's `mediaAssets`. Powers the native
 * review photo grid (A3-rev 4b).
 */
export type ClientAftercareReviewMediaDTO = {
  id: string
  /** IMAGE or VIDEO. */
  mediaType: MediaType
  /** Render-ready full-size URL, or null when it can't be resolved. */
  url: string | null
  /** Render-ready thumbnail URL, or null. */
  thumbUrl: string | null
  /** ISO instant the media was attached to the review. */
  createdAt: string
}

/**
 * The client's own review of this booking, when they've left one. Mirrors the
 * web `SafeExistingReview` (text slice + attached media); powers prefill + edit
 * and the photo grid in the native review block. Gated like `aftercare` (only
 * surfaced once a summary is sent).
 */
export type ClientAftercareExistingReviewDTO = {
  id: string
  /** The 1–5 star rating the client gave. */
  rating: number
  /** Optional review headline, or null. */
  headline: string | null
  /** Optional free-text review body, or null. */
  body: string | null
  /**
   * Photos/videos the client attached to their review (newest first; empty when
   * none). The client can add more (fresh uploads or "from this session") or
   * remove one (DELETE /client/reviews/[id]/media/[mediaId]).
   */
  mediaAssets: ClientAftercareReviewMediaDTO[]
}

export type ClientAftercareDetailDTO = {
  /**
   * Whether the client's aftercare surface is visible for this booking —
   * mirrors the web `canShowAftercareTab` gate (booking COMPLETED, or a sent
   * aftercare summary exists). When false the native client hides the section.
   */
  canShowAftercare: boolean
  /** The sent aftercare summary (care notes), or null when none is sent yet. */
  aftercare: ClientAftercareSummaryDTO | null
  /** Primary before/after pair (featured, else earliest per phase). */
  beforeAfter: BookingBeforeAfterThumbs
  /** The pro's product recommendations from the sent summary (empty if none). */
  recommendedProducts: ClientAftercareRecommendedProductDTO[]
  /** The client's current booking-checkout product selection (empty if none). */
  checkoutProducts: ClientAftercareCheckoutProductDTO[]
  /**
   * The pro's rebook recommendation (recommended window / proposed next
   * appointment) + the coupled next booking, or null when no summary is sent.
   */
  rebook: ClientAftercareRebookDTO | null
  /**
   * The client's existing review for this booking (text only), or null when
   * they haven't left one yet / no summary is sent. Prefills the native review
   * block for editing. Gated like `aftercare`.
   */
  existingReview: ClientAftercareExistingReviewDTO | null
  /**
   * Whether the client may leave or edit a review right now — mirrors the write
   * path's `canBookingAcceptClientReview` closeout gate (completed + finished
   * booking, finalized aftercare, collected payment). False until a summary is
   * sent. When false the native review block stays hidden.
   */
  reviewEligible: boolean
  /**
   * Whether the client may edit their checkout-product selection right now —
   * mirrors the write path's `assertClientCanEditBookingCheckoutProducts` gate
   * (finalized aftercare, not yet in/through payment, not completed/cancelled).
   * When false the native + web pickers render read-only.
   */
  checkoutProductsEditable: boolean
}

/** A recommendation row as selected from the sent aftercare summary. */
type AftercareRecommendedProductInput = {
  id: string
  productId: string | null
  note: string | null
  externalName: string | null
  externalUrl: string | null
  product: {
    id: string
    name: string
    brand: string | null
    retailPrice: Prisma.Decimal | null
  } | null
}

/** A checkout-product line as selected from the booking. */
type AftercareCheckoutProductInput = {
  recommendationId: string
  productId: string
  quantity: number
  unitPrice: Prisma.Decimal | null
}

function mapRecommendedProduct(
  row: AftercareRecommendedProductInput,
): ClientAftercareRecommendedProductDTO {
  return {
    id: row.id,
    productId: row.productId,
    note: row.note,
    externalName: row.externalName,
    externalUrl: row.externalUrl,
    product: row.product
      ? {
          id: row.product.id,
          name: row.product.name,
          brand: row.product.brand,
          retailPrice: moneyToString(row.product.retailPrice),
        }
      : null,
  }
}

function mapCheckoutProduct(
  row: AftercareCheckoutProductInput,
): ClientAftercareCheckoutProductDTO {
  return {
    recommendationId: row.recommendationId,
    productId: row.productId,
    quantity: row.quantity,
    unitPrice: moneyToString(row.unitPrice),
  }
}

/**
 * Build the client aftercare read DTO. `status` etc. are the booking's lifecycle
 * fields; `aftercare` is the SENT summary (already filtered to
 * `sentToClientAt != null`) with its recommendations, or null; `beforeAfter` is
 * the resolved pair; `checkoutProductItems` is the booking's current selection.
 */
export function buildClientAftercareDetailDTO(input: {
  status: BookingStatus | null
  finishedAt: Date | null
  checkoutStatus: BookingCheckoutStatus | null
  paymentAuthorizedAt: Date | null
  paymentCollectedAt: Date | null
  aftercare:
    | {
        id: string
        notes: string | null
        sentToClientAt: Date | null
        recommendedProducts: AftercareRecommendedProductInput[]
        rebookMode: AftercareRebookMode
        rebookedFor: Date | null
        rebookWindowStart: Date | null
        rebookWindowEnd: Date | null
        rebookDeclinedAt: Date | null
      }
    | null
  beforeAfter: BookingBeforeAfterThumbs
  checkoutProductItems: AftercareCheckoutProductInput[]
  /**
   * The AFTERCARE-sourced booking whose `rebookOfBookingId` points back at this
   * booking (the client's coupled next appointment), or null. Loaded alongside
   * the summary; surfaced so the rebook card can show a confirmed/pending state.
   */
  rebookedNextBooking: {
    id: string
    status: BookingStatus
    scheduledFor: Date | null
  } | null
  /**
   * The client's existing review for this booking (text slice + attached media),
   * or null. `mediaAssets` URLs are already render-resolved by the caller (the
   * route resolves them via `renderMediaUrlsBatch`, matching the web loader).
   * Loaded alongside the summary; only surfaced once a summary is sent.
   */
  review: {
    id: string
    rating: number
    headline: string | null
    body: string | null
    mediaAssets: Array<{
      id: string
      mediaType: MediaType
      url: string | null
      thumbUrl: string | null
      createdAt: Date
    }>
  } | null
}): ClientAftercareDetailDTO {
  const aftercare = input.aftercare
    ? {
        id: input.aftercare.id,
        notes: input.aftercare.notes,
        sentToClientAt: input.aftercare.sentToClientAt?.toISOString() ?? null,
      }
    : null

  const rebook: ClientAftercareRebookDTO | null = input.aftercare
    ? {
        mode: input.aftercare.rebookMode,
        rebookedFor: input.aftercare.rebookedFor?.toISOString() ?? null,
        windowStart: input.aftercare.rebookWindowStart?.toISOString() ?? null,
        windowEnd: input.aftercare.rebookWindowEnd?.toISOString() ?? null,
        declinedAt: input.aftercare.rebookDeclinedAt?.toISOString() ?? null,
        nextBooking: input.rebookedNextBooking
          ? {
              id: input.rebookedNextBooking.id,
              status: input.rebookedNextBooking.status,
              scheduledFor:
                input.rebookedNextBooking.scheduledFor?.toISOString() ?? null,
            }
          : null,
      }
    : null

  // Review fields are gated exactly like `aftercare`: only surface a client's
  // review (and only claim they can leave one) once the pro has SENT the summary
  // — `reviewEligible` additionally requires the full closeout to be complete,
  // mirroring the write path's `canBookingAcceptClientReview` gate.
  const summarySent = Boolean(input.aftercare)
  const existingReview: ClientAftercareExistingReviewDTO | null =
    summarySent && input.review
      ? {
          id: input.review.id,
          rating: input.review.rating,
          headline: input.review.headline,
          body: input.review.body,
          mediaAssets: input.review.mediaAssets.map((asset) => ({
            id: asset.id,
            mediaType: asset.mediaType,
            url: asset.url,
            thumbUrl: asset.thumbUrl,
            createdAt: asset.createdAt.toISOString(),
          })),
        }
      : null
  const reviewEligible = summarySent
    ? isBookingReviewEligible({
        bookingStatus: input.status,
        finishedAt: input.finishedAt,
        aftercareSentAt: input.aftercare?.sentToClientAt ?? null,
        checkoutStatus: input.checkoutStatus,
        paymentCollectedAt: input.paymentCollectedAt,
      })
    : false

  return {
    canShowAftercare: isClientAftercareVisible({
      status: input.status,
      hasSentAftercare: Boolean(aftercare),
    }),
    aftercare,
    beforeAfter: input.beforeAfter,
    recommendedProducts: (input.aftercare?.recommendedProducts ?? []).map(
      mapRecommendedProduct,
    ),
    checkoutProducts: input.checkoutProductItems.map(mapCheckoutProduct),
    rebook,
    existingReview,
    reviewEligible,
    checkoutProductsEditable: clientCanEditBookingCheckoutProducts({
      status: input.status,
      finishedAt: input.finishedAt,
      checkoutStatus: input.checkoutStatus,
      paymentAuthorizedAt: input.paymentAuthorizedAt,
      paymentCollectedAt: input.paymentCollectedAt,
      aftercareSentAt: input.aftercare?.sentToClientAt ?? null,
    }),
  }
}
