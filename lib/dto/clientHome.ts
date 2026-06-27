// lib/dto/clientHome.ts
//
// JSON-safe serializer for the client home screen. Wraps the SAME loader the
// server-rendered /client home page uses (getClientHomeData) and converts every
// Prisma.Decimal -> string (via the money SSOT) and every Date -> ISO string at
// the edge, so the native read API and the web page share one query.
import type { Prisma } from '@prisma/client'

import { moneyToString } from '@/lib/money'
import type { BookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'
import type {
  ClientHomeAftercare,
  ClientHomeBooking,
  ClientHomeData,
  ClientHomeFavoritePro,
  ClientHomeFavoriteService,
  ClientHomeLastMinuteInvite,
  ClientHomeViralLive,
  ClientHomeViralPending,
  ClientHomeWaitlistEntry,
} from '@/app/client/(gated)/_data/getClientHomeData'

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

type ClientHomeBookingServiceItemDTO = {
  id: string
  itemType: string
  parentItemId: string | null
  sortOrder: number
  durationMinutesSnapshot: number | null
  priceSnapshot: string | null
  serviceId: string
  service: { name: string } | null
}

type ClientHomeBookingProductSaleDTO = {
  id: string
  productId: string | null
  quantity: number
  unitPrice: string | null
  product: { name: string } | null
}

type ClientHomeConsultationApprovalDTO = {
  status: string
  proposedServicesJson: Prisma.JsonValue
  proposedTotal: string | null
  notes: string | null
  approvedAt: string | null
  rejectedAt: string | null
}

export type ClientHomeBookingDTO = {
  id: string
  status: string
  source: string
  sessionStep: string
  scheduledFor: string
  finishedAt: string | null

  subtotalSnapshot: string | null
  serviceSubtotalSnapshot: string | null
  productSubtotalSnapshot: string | null
  totalAmount: string | null
  tipAmount: string | null
  taxAmount: string | null
  discountAmount: string | null
  checkoutStatus: string | null
  selectedPaymentMethod: string | null
  paymentAuthorizedAt: string | null
  paymentCollectedAt: string | null

  totalDurationMinutes: number
  bufferMinutes: number

  locationType: string | null
  locationId: string | null
  locationTimeZone: string | null
  locationAddressSnapshot: unknown

  service: { id: string; name: string } | null

  professional: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    location: string | null
    timeZone: string | null
  } | null

  location: {
    id: string
    name: string | null
    formattedAddress: string | null
    city: string | null
    state: string | null
    timeZone: string | null
  } | null

  serviceItems: ClientHomeBookingServiceItemDTO[]
  productSales: ClientHomeBookingProductSaleDTO[]

  consultationNotes: string | null
  consultationPrice: string | null
  consultationConfirmedAt: string | null
  consultationApproval: ClientHomeConsultationApprovalDTO | null
}

export type ClientHomeAftercareDTO = {
  id: string
  notes: string | null
  rebookMode: string | null
  rebookedFor: string | null
  rebookWindowStart: string | null
  rebookWindowEnd: string | null
  draftSavedAt: string | null
  sentToClientAt: string | null
  lastEditedAt: string | null
  version: number
  recommendedProducts: {
    id: string
    productId: string | null
    note: string | null
    externalName: string | null
    externalUrl: string | null
    product: {
      id: string
      name: string
      brand: string | null
      retailPrice: string | null
    } | null
  }[]
}

export type ClientHomeActionDTO =
  | {
      kind: 'PENDING_CONSULTATION'
      booking: ClientHomeBookingDTO
    }
  | {
      kind: 'AFTERCARE_PAYMENT_DUE'
      aftercare: ClientHomeAftercareDTO
      booking: ClientHomeBookingDTO
      beforeAfter: BookingBeforeAfterThumbs
    }
  | null

export type ClientHomeLastMinuteInviteDTO = {
  id: string
  firstMatchedTier: string
  notifiedTier: string | null
  status: string
  notifiedAt: string | null
  openedAt: string | null
  clickedAt: string | null
  bookedAt: string | null
  createdAt: string
  opening: {
    id: string
    professionalId: string
    startAt: string
    endAt: string | null
    note: string | null
    status: string
    visibilityMode: string
    publicVisibleFrom: string | null
    publicVisibleUntil: string | null
    timeZone: string | null
    locationType: string | null
    locationId: string | null
    professional: {
      id: string
      businessName: string | null
      handle: string | null
      avatarUrl: string | null
      professionType: string | null
      location: string | null
      timeZone: string | null
    }
    location: {
      id: string
      type: string
      timeZone: string | null
      city: string | null
      state: string | null
      formattedAddress: string | null
      lat: string | null
      lng: string | null
    } | null
    services: {
      id: string
      openingId: string
      serviceId: string
      offeringId: string
      sortOrder: number
      service: {
        id: string
        name: string
        minPrice: string
        defaultDurationMinutes: number
      }
      offering: {
        id: string
        title: string | null
        salonPriceStartingAt: string | null
        mobilePriceStartingAt: string | null
        salonDurationMinutes: number | null
        mobileDurationMinutes: number | null
        offersInSalon: boolean
        offersMobile: boolean
      }
    }[]
    tierPlans: {
      id: string
      tier: string
      scheduledFor: string
      offerType: string
      percentOff: number | null
      amountOff: string | null
      freeAddOnServiceId: string | null
      freeAddOnService: { id: string; name: string } | null
    }[]
  }
}

export type ClientHomeWaitlistEntryDTO = {
  id: string
  createdAt: string
  notes: string | null
  mediaId: string | null
  status: string
  preferenceType: string
  specificDate: string | null
  timeOfDay: string | null
  windowStartMin: number | null
  windowEndMin: number | null
  service: { id: string; name: string } | null
  professional: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    location: string | null
    timeZone: string | null
  } | null
}

export type ClientHomeFavoriteProDTO = {
  professional: {
    id: string
    businessName: string | null
    handle: string | null
    avatarUrl: string | null
    professionType: string | null
    location: string | null
  } | null
}

export type ClientHomeFavoriteServiceDTO = {
  id: string
  service: {
    id: string
    name: string
    minPrice: string
    defaultDurationMinutes: number
    defaultImageUrl: string | null
    category: { id: string; name: string } | null
  } | null
}

export type ClientHomeViralLiveDTO = {
  id: string
  name: string
  sourceUrl: string | null
  approvedAt: string | null
  _count: { approvalFanOuts: number }
}

export type ClientHomeViralPendingDTO = {
  id: string
  name: string
  sourceUrl: string | null
  status: string
  createdAt: string
  _count: { approvalFanOuts: number }
}

export type ClientHomeDTO = {
  upcoming: ClientHomeBookingDTO | null
  upcomingCount: number
  action: ClientHomeActionDTO
  invites: ClientHomeLastMinuteInviteDTO[]
  waitlists: ClientHomeWaitlistEntryDTO[]
  favoritePros: ClientHomeFavoriteProDTO[]
  favoriteServices: ClientHomeFavoriteServiceDTO[]
  viralLive: ClientHomeViralLiveDTO[]
  viralPending: ClientHomeViralPendingDTO[]
}

function serializeBooking(b: ClientHomeBooking): ClientHomeBookingDTO {
  return {
    id: b.id,
    status: b.status,
    source: b.source,
    sessionStep: b.sessionStep,
    scheduledFor: b.scheduledFor.toISOString(),
    finishedAt: iso(b.finishedAt),

    subtotalSnapshot: moneyToString(b.subtotalSnapshot),
    serviceSubtotalSnapshot: moneyToString(b.serviceSubtotalSnapshot),
    productSubtotalSnapshot: moneyToString(b.productSubtotalSnapshot),
    totalAmount: moneyToString(b.totalAmount),
    tipAmount: moneyToString(b.tipAmount),
    taxAmount: moneyToString(b.taxAmount),
    discountAmount: moneyToString(b.discountAmount),
    checkoutStatus: b.checkoutStatus ?? null,
    selectedPaymentMethod: b.selectedPaymentMethod ?? null,
    paymentAuthorizedAt: iso(b.paymentAuthorizedAt),
    paymentCollectedAt: iso(b.paymentCollectedAt),

    totalDurationMinutes: b.totalDurationMinutes,
    bufferMinutes: b.bufferMinutes,

    locationType: b.locationType ?? null,
    locationId: b.locationId ?? null,
    locationTimeZone: b.locationTimeZone ?? null,
    locationAddressSnapshot: b.locationAddressSnapshot ?? null,

    service: b.service ? { id: b.service.id, name: b.service.name } : null,

    professional: b.professional
      ? {
          id: b.professional.id,
          businessName: b.professional.businessName ?? null,
          handle: b.professional.handle ?? null,
          avatarUrl: b.professional.avatarUrl ?? null,
          location: b.professional.location ?? null,
          timeZone: b.professional.timeZone ?? null,
        }
      : null,

    location: b.location
      ? {
          id: b.location.id,
          name: b.location.name ?? null,
          formattedAddress: b.location.formattedAddress ?? null,
          city: b.location.city ?? null,
          state: b.location.state ?? null,
          timeZone: b.location.timeZone ?? null,
        }
      : null,

    serviceItems: b.serviceItems.map((it) => ({
      id: it.id,
      itemType: it.itemType,
      parentItemId: it.parentItemId ?? null,
      sortOrder: it.sortOrder,
      durationMinutesSnapshot: it.durationMinutesSnapshot ?? null,
      priceSnapshot: moneyToString(it.priceSnapshot),
      serviceId: it.serviceId,
      service: it.service ? { name: it.service.name } : null,
    })),

    productSales: b.productSales.map((sale) => ({
      id: sale.id,
      productId: sale.productId ?? null,
      quantity: sale.quantity,
      unitPrice: moneyToString(sale.unitPrice),
      product: sale.product ? { name: sale.product.name } : null,
    })),

    consultationNotes: b.consultationNotes ?? null,
    consultationPrice: moneyToString(b.consultationPrice),
    consultationConfirmedAt: iso(b.consultationConfirmedAt),
    consultationApproval: b.consultationApproval
      ? {
          status: b.consultationApproval.status,
          proposedServicesJson: b.consultationApproval.proposedServicesJson,
          proposedTotal: moneyToString(b.consultationApproval.proposedTotal),
          notes: b.consultationApproval.notes ?? null,
          approvedAt: iso(b.consultationApproval.approvedAt),
          rejectedAt: iso(b.consultationApproval.rejectedAt),
        }
      : null,
  }
}

function serializeAftercare(a: ClientHomeAftercare): ClientHomeAftercareDTO {
  return {
    id: a.id,
    notes: a.notes ?? null,
    rebookMode: a.rebookMode ?? null,
    rebookedFor: iso(a.rebookedFor),
    rebookWindowStart: iso(a.rebookWindowStart),
    rebookWindowEnd: iso(a.rebookWindowEnd),
    draftSavedAt: iso(a.draftSavedAt),
    sentToClientAt: iso(a.sentToClientAt),
    lastEditedAt: iso(a.lastEditedAt),
    version: a.version,
    recommendedProducts: a.recommendedProducts.map((p) => ({
      id: p.id,
      productId: p.productId ?? null,
      note: p.note ?? null,
      externalName: p.externalName ?? null,
      externalUrl: p.externalUrl ?? null,
      product: p.product
        ? {
            id: p.product.id,
            name: p.product.name,
            brand: p.product.brand ?? null,
            retailPrice: moneyToString(p.product.retailPrice),
          }
        : null,
    })),
  }
}

function serializeInvite(
  invite: ClientHomeLastMinuteInvite,
): ClientHomeLastMinuteInviteDTO {
  const opening = invite.opening
  return {
    id: invite.id,
    firstMatchedTier: invite.firstMatchedTier,
    notifiedTier: invite.notifiedTier ?? null,
    status: invite.status,
    notifiedAt: iso(invite.notifiedAt),
    openedAt: iso(invite.openedAt),
    clickedAt: iso(invite.clickedAt),
    bookedAt: iso(invite.bookedAt),
    createdAt: invite.createdAt.toISOString(),
    opening: {
      id: opening.id,
      professionalId: opening.professionalId,
      startAt: opening.startAt.toISOString(),
      endAt: iso(opening.endAt),
      note: opening.note ?? null,
      status: opening.status,
      visibilityMode: opening.visibilityMode,
      publicVisibleFrom: iso(opening.publicVisibleFrom),
      publicVisibleUntil: iso(opening.publicVisibleUntil),
      timeZone: opening.timeZone ?? null,
      locationType: opening.locationType ?? null,
      locationId: opening.locationId ?? null,
      professional: {
        id: opening.professional.id,
        businessName: opening.professional.businessName ?? null,
        handle: opening.professional.handle ?? null,
        avatarUrl: opening.professional.avatarUrl ?? null,
        professionType: opening.professional.professionType ?? null,
        location: opening.professional.location ?? null,
        timeZone: opening.professional.timeZone ?? null,
      },
      location: opening.location
        ? {
            id: opening.location.id,
            type: opening.location.type,
            timeZone: opening.location.timeZone ?? null,
            city: opening.location.city ?? null,
            state: opening.location.state ?? null,
            formattedAddress: opening.location.formattedAddress ?? null,
            lat: moneyToString(opening.location.lat),
            lng: moneyToString(opening.location.lng),
          }
        : null,
      services: opening.services.map((s) => ({
        id: s.id,
        openingId: s.openingId,
        serviceId: s.serviceId,
        offeringId: s.offeringId,
        sortOrder: s.sortOrder,
        service: {
          id: s.service.id,
          name: s.service.name,
          minPrice: s.service.minPrice.toString(),
          defaultDurationMinutes: s.service.defaultDurationMinutes,
        },
        offering: {
          id: s.offering.id,
          title: s.offering.title ?? null,
          salonPriceStartingAt: moneyToString(s.offering.salonPriceStartingAt),
          mobilePriceStartingAt: moneyToString(s.offering.mobilePriceStartingAt),
          salonDurationMinutes: s.offering.salonDurationMinutes,
          mobileDurationMinutes: s.offering.mobileDurationMinutes,
          offersInSalon: s.offering.offersInSalon,
          offersMobile: s.offering.offersMobile,
        },
      })),
      tierPlans: opening.tierPlans.map((plan) => ({
        id: plan.id,
        tier: plan.tier,
        scheduledFor: plan.scheduledFor.toISOString(),
        offerType: plan.offerType,
        percentOff: plan.percentOff ?? null,
        amountOff: moneyToString(plan.amountOff),
        freeAddOnServiceId: plan.freeAddOnServiceId ?? null,
        freeAddOnService: plan.freeAddOnService
          ? {
              id: plan.freeAddOnService.id,
              name: plan.freeAddOnService.name,
            }
          : null,
      })),
    },
  }
}

function serializeWaitlist(
  entry: ClientHomeWaitlistEntry,
): ClientHomeWaitlistEntryDTO {
  return {
    id: entry.id,
    createdAt: entry.createdAt.toISOString(),
    notes: entry.notes ?? null,
    mediaId: entry.mediaId ?? null,
    status: entry.status,
    preferenceType: entry.preferenceType,
    specificDate: iso(entry.specificDate),
    timeOfDay: entry.timeOfDay ?? null,
    windowStartMin: entry.windowStartMin ?? null,
    windowEndMin: entry.windowEndMin ?? null,
    service: entry.service
      ? { id: entry.service.id, name: entry.service.name }
      : null,
    professional: entry.professional
      ? {
          id: entry.professional.id,
          businessName: entry.professional.businessName ?? null,
          handle: entry.professional.handle ?? null,
          avatarUrl: entry.professional.avatarUrl ?? null,
          location: entry.professional.location ?? null,
          timeZone: entry.professional.timeZone ?? null,
        }
      : null,
  }
}

function serializeFavoritePro(
  fav: ClientHomeFavoritePro,
): ClientHomeFavoriteProDTO {
  return {
    professional: fav.professional
      ? {
          id: fav.professional.id,
          businessName: fav.professional.businessName ?? null,
          handle: fav.professional.handle ?? null,
          avatarUrl: fav.professional.avatarUrl ?? null,
          professionType: fav.professional.professionType ?? null,
          location: fav.professional.location ?? null,
        }
      : null,
  }
}

function serializeFavoriteService(
  fav: ClientHomeFavoriteService,
): ClientHomeFavoriteServiceDTO {
  return {
    id: fav.id,
    service: fav.service
      ? {
          id: fav.service.id,
          name: fav.service.name,
          minPrice: fav.service.minPrice.toString(),
          defaultDurationMinutes: fav.service.defaultDurationMinutes,
          defaultImageUrl: fav.service.defaultImageUrl ?? null,
          category: fav.service.category
            ? { id: fav.service.category.id, name: fav.service.category.name }
            : null,
        }
      : null,
  }
}

function serializeViralLive(row: ClientHomeViralLive): ClientHomeViralLiveDTO {
  return {
    id: row.id,
    name: row.name,
    sourceUrl: row.sourceUrl ?? null,
    approvedAt: iso(row.approvedAt),
    _count: { approvalFanOuts: row._count.approvalFanOuts },
  }
}

function serializeViralPending(
  row: ClientHomeViralPending,
): ClientHomeViralPendingDTO {
  return {
    id: row.id,
    name: row.name,
    sourceUrl: row.sourceUrl ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    _count: { approvalFanOuts: row._count.approvalFanOuts },
  }
}

function serializeAction(action: ClientHomeData['action']): ClientHomeActionDTO {
  if (!action) return null

  if (action.kind === 'PENDING_CONSULTATION') {
    return {
      kind: 'PENDING_CONSULTATION',
      booking: serializeBooking(action.booking),
    }
  }

  return {
    kind: 'AFTERCARE_PAYMENT_DUE',
    aftercare: serializeAftercare(action.aftercare),
    booking: serializeBooking(action.booking),
    beforeAfter: action.beforeAfter,
  }
}

export function serializeClientHomeData(data: ClientHomeData): ClientHomeDTO {
  return {
    upcoming: data.upcoming ? serializeBooking(data.upcoming) : null,
    upcomingCount: data.upcomingCount,
    action: serializeAction(data.action),
    invites: data.invites.map(serializeInvite),
    waitlists: data.waitlists.map(serializeWaitlist),
    favoritePros: data.favoritePros.map(serializeFavoritePro),
    favoriteServices: data.favoriteServices.map(serializeFavoriteService),
    viralLive: data.viralLive.map(serializeViralLive),
    viralPending: data.viralPending.map(serializeViralPending),
  }
}
