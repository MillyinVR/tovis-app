// lib/consult/serviceIdentity.ts
//
// WHICH SERVICE a consult is about, by id and by name — the one answer, for
// both anchors.
//
// The booking anchor names its service directly. The look anchor names it
// through the Look's primary-service linkage, which Book the Look kept as raw
// material precisely for this (docs/product/BOOK-THE-LOOK-DIRECTION.md,
// decision 1) and which `lib/looks/serviceOwnership.ts` is the single source of
// truth for. Neither is re-derived here.
//
// TWO names, because the two audiences are told different things (handoff
// Stage 6: "services by name — pro-facing name AND plain-language client
// name"):
//
//   * `proFacingName` is the catalog `Service.name`. It is what the pro's menu
//     calls it, and it is the exact string the analysis recommends from
//     (`menuServiceNames`), so it must not be prettified.
//   * `clientFacingName` is the pro's own offering title where they set one,
//     the catalog name otherwise — the same rule the public profile already
//     shows a client (`lib/profiles/publicProfileMappers.ts`), through the
//     shared `offeringDisplayName` helper.
//
// A consult can legitimately have NO resolvable service: a Look whose linked
// service row was deleted. That is `null`, never a guess — the flow says "your
// consult" instead of naming the wrong thing.

import type { Prisma } from '@prisma/client'

import {
  resolveLookPrimaryService,
  toLookPrimaryServiceSummary,
} from '@/lib/looks/serviceOwnership'
import { offeringDisplayName } from '@/lib/pro/offeringDisplayName'

export type ConsultServiceIdentity = {
  serviceId: string | null
  /** The catalog service name — what the pro's menu calls it. */
  proFacingName: string | null
  /** What the client is shown — the pro's offering title when they set one. */
  clientFacingName: string | null
}

export const CONSULT_SERVICE_IDENTITY_NONE: ConsultServiceIdentity = {
  serviceId: null,
  proFacingName: null,
  clientFacingName: null,
}

/** Spread into a ConsultSession select to resolve a booking-anchored service. */
export const CONSULT_SERVICE_IDENTITY_BOOKING_SELECT = {
  serviceId: true,
  service: { select: { name: true } },
} satisfies Prisma.BookingSelect

/** Spread into a LookPost select to resolve a look-anchored service. */
export const CONSULT_SERVICE_IDENTITY_LOOK_SELECT = {
  serviceId: true,
  service: {
    select: {
      id: true,
      name: true,
      category: { select: { name: true, slug: true } },
    },
  },
} satisfies Prisma.LookPostSelect

type LookAnchorShape = Prisma.LookPostGetPayload<{
  select: typeof CONSULT_SERVICE_IDENTITY_LOOK_SELECT
}>

/**
 * The service a Look maps to. `serviceId` survives even when the Service row
 * itself is gone, which is why the id and the names are resolved separately.
 */
export function consultServiceIdentityFromLook(
  look: LookAnchorShape | null,
): ConsultServiceIdentity {
  if (!look) return CONSULT_SERVICE_IDENTITY_NONE
  const primary = toLookPrimaryServiceSummary(
    resolveLookPrimaryService({ serviceId: look.serviceId, service: look.service }),
  )
  if (!primary) return CONSULT_SERVICE_IDENTITY_NONE
  return {
    serviceId: primary.id,
    proFacingName: primary.name,
    clientFacingName: primary.name,
  }
}

export function consultServiceIdentityFromBooking(booking: {
  serviceId: string
  service: { name: string }
}): ConsultServiceIdentity {
  return {
    serviceId: booking.serviceId,
    proFacingName: booking.service.name,
    clientFacingName: booking.service.name,
  }
}

/**
 * The client-facing name upgraded with the pro's own title for this service,
 * when the professional set one. Separate from the resolvers above because the
 * offering is a different row: a caller that has not loaded it gets the
 * catalog name rather than a wrong one.
 */
export function withProfessionalOfferingTitle(
  identity: ConsultServiceIdentity,
  offering: { title: string | null } | null,
): ConsultServiceIdentity {
  if (!offering || !identity.proFacingName) return identity
  return {
    ...identity,
    clientFacingName: offeringDisplayName({
      title: offering.title,
      service: { name: identity.proFacingName },
    }),
  }
}

/**
 * The whole answer for a consult session, for either anchor: the service, and
 * the pro's own title for it.
 *
 * Lives here rather than in one caller because two surfaces now need the same
 * answer — the intake state (which names the service on the screen it belongs
 * to) and the thread projection (whose opening bubble names it before any
 * intake exists). A second copy of "which look, then which offering" is exactly
 * how one of them ends up naming a service the other does not.
 *
 * Takes the client as a parameter so it composes inside a caller's transaction
 * as easily as it runs on its own.
 */
export async function resolveConsultServiceIdentity(
  db: Pick<Prisma.TransactionClient, 'lookPost' | 'professionalServiceOffering'>,
  session: {
    professionalId: string
    anchorLookPostId: string | null
    booking: { serviceId: string; service: { name: string } } | null
  },
): Promise<ConsultServiceIdentity> {
  const base = session.booking
    ? consultServiceIdentityFromBooking(session.booking)
    : consultServiceIdentityFromLook(
        session.anchorLookPostId
          ? await db.lookPost.findUnique({
              where: { id: session.anchorLookPostId },
              select: CONSULT_SERVICE_IDENTITY_LOOK_SELECT,
            })
          : null,
      )
  if (!base.serviceId) return CONSULT_SERVICE_IDENTITY_NONE
  const offering = await db.professionalServiceOffering.findFirst({
    where: { professionalId: session.professionalId, serviceId: base.serviceId },
    select: { title: true },
  })
  return withProfessionalOfferingTitle(base, offering)
}
