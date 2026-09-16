// lib/viralRequests/catalogService.ts
//
// Turning a viral look into a real catalog `Service` — the step that makes the
// whole feature a translation layer rather than a name on a card.
//
// ── Tori, 2026-09-15, the flow in her own words ────────────────────────────
//
// *"say 'bubble gum nails' is requested by a client — the admin sees the
// request, decides what type of pro would offer that service, we figure out how
// the service is done, give the description to the pro, they choose to add it to
// their menu or not, then the client can book that service. that way the client
// and the pro are speaking the same language when it comes to what is trending
// on other platforms."*
//
// This module is "the admin sees the request … give the description to the pro".
// It does not approve anything and it does not notify anyone.
//
// ── Two deliberate refusals ────────────────────────────────────────────────
//
//  1. **Nothing is inferred.** *"so when the admin approves or adds a viral
//     service it should be connected on our end to the actual service the pro
//     will be doing."* The category, the base services and the name all come
//     from the admin. There is no matcher here, and there must not be one: a
//     guess that looks right is how "Bubble Gum Nails" ends up filed as a
//     haircut with nobody noticing.
//  2. **An existing name is never silently adopted.** `Service.name` is
//     `@unique`, and two clients can ask for the same trending look. Rather than
//     upserting by name — which would quietly rewrite a real catalog row's
//     breakdown and base links — the caller must say which it means: create a
//     new service, or attach `existingServiceId` explicitly.
//
// ── Why minPrice is zero ───────────────────────────────────────────────────
//
// 🔴 `Service.minPrice` is a FLOOR on the charged price: booking resolves
// `max(pro's listPrice, service.minPrice)` (lib/booking/rampedUnitPrice.ts).
// Tori: the pro sets their own price and *"no price is ever set by the
// platform"* — so a viral service's floor is 0, and the pro's price stands
// exactly as they set it. This is safe rather than a route to a £0 booking: an
// offering with no price cannot be booked at all (`pricingNotSetCode` in
// lib/booking/serviceItems.ts), so there is no path where 0 becomes the amount.
//
// `defaultDurationMinutes` is different and is genuinely required: it is the
// FALLBACK used only when a pro leaves their own duration blank, and a duration
// of 0 makes a booking throw. It is part of "we figure out how the service is
// done", so the admin supplies it, and the pro's own value always wins.

import { Prisma } from '@prisma/client'

import { replaceViralBaseServiceLinks } from '@/lib/services/viralBaseServiceLinks'

/** A viral service never floors the pro's price — see the note above. */
export const VIRAL_SERVICE_MIN_PRICE = new Prisma.Decimal(0)

export class ViralCatalogServiceNameTakenError extends Error {
  constructor(readonly serviceName: string) {
    super(
      `A service named "${serviceName}" already exists. Attach it explicitly ` +
        'or choose a different name.',
    )
    this.name = 'ViralCatalogServiceNameTakenError'
  }
}

export class ViralCatalogServiceNotFoundError extends Error {
  constructor() {
    super('That service does not exist.')
    this.name = 'ViralCatalogServiceNotFoundError'
  }
}

export type ViralCatalogServiceInput =
  | {
      /** Create the catalog entry for this look. */
      mode: 'create'
      name: string
      categoryId: string
      /** CLIENT-facing. The look's blurb. */
      description: string | null
      /** PRO-facing. How the work is done, in professional terms. */
      proBreakdown: string | null
      defaultDurationMinutes: number
    }
  | {
      /**
       * Attach a catalog entry that already exists — the second client to ask
       * for the same trending name, or a name an admin created ahead of time.
       */
      mode: 'attach'
      serviceId: string
    }

export type LinkedViralCatalogService = {
  serviceId: string
  serviceName: string
  categoryId: string
  created: boolean
  baseServiceIds: string[]
}

/**
 * Give a viral look its catalog service, link the real work underneath it, and
 * record both on the request.
 *
 * Runs entirely inside the caller's transaction: a service with no base links,
 * or a request pointing at a service that was rolled back, are both states no
 * reader should ever see.
 *
 * Also sets `requestedCategoryId` from the service's category. That column is
 * what the approval fan-out matches pros on
 * (`findMatchingProsByRequestedCategory`), and nothing else in the product ever
 * set it — every seeded request has it NULL, so approval fanned out to nobody.
 * The admin's *"what type of pro would offer that service"* answer is the same
 * answer both questions need.
 */
export async function linkViralLookToCatalogService(
  tx: Prisma.TransactionClient,
  args: {
    requestId: string
    service: ViralCatalogServiceInput
    baseServiceIds: readonly string[]
  },
): Promise<LinkedViralCatalogService> {
  let serviceId: string
  let serviceName: string
  let categoryId: string
  let created = false

  if (args.service.mode === 'create') {
    const existing = await tx.service.findUnique({
      where: { name: args.service.name },
      select: { id: true },
    })

    if (existing) {
      throw new ViralCatalogServiceNameTakenError(args.service.name)
    }

    const row = await tx.service.create({
      data: {
        name: args.service.name,
        categoryId: args.service.categoryId,
        description: args.service.description,
        proBreakdown: args.service.proBreakdown,
        defaultDurationMinutes: args.service.defaultDurationMinutes,
        minPrice: VIRAL_SERVICE_MIN_PRICE,
        isActive: true,
      },
      select: { id: true, name: true, categoryId: true },
    })

    serviceId = row.id
    serviceName = row.name
    categoryId = row.categoryId
    created = true
  } else {
    const row = await tx.service.findUnique({
      where: { id: args.service.serviceId },
      select: { id: true, name: true, categoryId: true },
    })

    if (!row) throw new ViralCatalogServiceNotFoundError()

    serviceId = row.id
    serviceName = row.name
    categoryId = row.categoryId
  }

  // Throws on an empty set, a self-link or a chain — before any link is written.
  await replaceViralBaseServiceLinks(tx, {
    viralServiceId: serviceId,
    baseServiceIds: args.baseServiceIds,
  })

  await tx.viralServiceRequest.update({
    where: { id: args.requestId },
    data: { serviceId, requestedCategoryId: categoryId },
  })

  const links = await tx.viralServiceBaseService.findMany({
    where: { viralServiceId: serviceId },
    select: { baseServiceId: true },
    orderBy: { baseServiceId: 'asc' },
  })

  return {
    serviceId,
    serviceName,
    categoryId,
    created,
    baseServiceIds: links.map((row) => row.baseServiceId),
  }
}
