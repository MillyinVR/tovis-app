// lib/consult/lookAnchor.ts
//
// Turning a LookPost into a consult anchor: which professional, which service
// category, and — the part that has to be decided rather than defaulted — what
// happens when a Look has no service linkage at all.
//
// Book the Look (B1) took service NAMES off the client-facing feed but kept the
// look↔service linkage as raw material precisely for this
// (docs/product/BOOK-THE-LOOK-DIRECTION.md, decision 1). The linkage is read
// through lib/looks/serviceOwnership.ts, the existing single source of truth,
// never re-derived here.
//
// 🔴 A Look with NO resolvable service is a TYPED REFUSAL, not a fallback
// category. `ConsultSession.serviceCategoryId` is a required FK and the founder
// pilot admits exactly one vertical, so any fallback would have to invent a
// category — which would either park the consult in a vertical whose intake
// pack does not exist, or silently mislabel the client's session in the pro's
// brief. A refusal the client can see beats a guess she cannot.

import type { Prisma } from '@prisma/client'

import {
  resolveLookPrimaryService,
  toLookPrimaryServiceSummary,
} from '@/lib/looks/serviceOwnership'

import { isConsultCategoryInScope } from './serviceScope'

export const CONSULT_LOOK_ANCHOR_SELECT = {
  id: true,
  professionalId: true,
  serviceId: true,
  service: {
    select: {
      id: true,
      name: true,
      category: { select: { id: true, name: true, slug: true } },
    },
  },
} satisfies Prisma.LookPostSelect

export type ConsultLookAnchorSource = Prisma.LookPostGetPayload<{
  select: typeof CONSULT_LOOK_ANCHOR_SELECT
}>

export type ConsultLookAnchorRefusalCode =
  /** The Look names no service at all — nothing to derive a category from. */
  | 'LOOK_SERVICE_UNLINKED'
  /** Linked, but to a service whose category is outside the founder pilot. */
  | 'LOOK_VERTICAL_NOT_ENABLED'

export type ConsultLookAnchorResolution =
  | {
      ok: true
      lookPostId: string
      professionalId: string
      serviceCategoryId: string
    }
  | { ok: false; reason: ConsultLookAnchorRefusalCode }

/**
 * The pro is the Look's own `professionalId` — for a client-authored look that
 * is still the visited pro (schema comment on LookPost), which is exactly who
 * "book this look" means.
 */
export function resolveConsultLookAnchor(
  look: ConsultLookAnchorSource,
): ConsultLookAnchorResolution {
  const primary = toLookPrimaryServiceSummary(
    resolveLookPrimaryService({
      serviceId: look.serviceId,
      service: look.service,
    }),
  )

  if (!primary || !look.service?.category) {
    return { ok: false, reason: 'LOOK_SERVICE_UNLINKED' }
  }
  if (!isConsultCategoryInScope({ slug: primary.categorySlug })) {
    return { ok: false, reason: 'LOOK_VERTICAL_NOT_ENABLED' }
  }

  return {
    ok: true,
    lookPostId: look.id,
    professionalId: look.professionalId,
    serviceCategoryId: look.service.category.id,
  }
}
