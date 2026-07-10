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

import type { BookingCheckoutStatus, BookingStatus, Prisma } from '@prisma/client'

import { isClientAftercareVisible } from '@/lib/aftercare/aftercareVisibility'
import { clientCanEditBookingCheckoutProducts } from '@/lib/booking/checkoutProductsEditable'
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
      }
    | null
  beforeAfter: BookingBeforeAfterThumbs
  checkoutProductItems: AftercareCheckoutProductInput[]
}): ClientAftercareDetailDTO {
  const aftercare = input.aftercare
    ? {
        id: input.aftercare.id,
        notes: input.aftercare.notes,
        sentToClientAt: input.aftercare.sentToClientAt?.toISOString() ?? null,
      }
    : null

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
