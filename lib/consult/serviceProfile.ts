// lib/consult/serviceProfile.ts
//
// ONE answer to "what kind of service is this consult about, and what does
// that mean for it?". Every service-specific choice downstream — which intake
// pack to serve, which safety policy to apply, (later) which capture pack and
// which analysis lens — is read off the profile. Nothing downstream reads a
// category slug to decide behaviour; the slug is data the profile carries.
//
// The profile keys on `ServiceCategory.consultFamily`, so a category created
// tomorrow resolves the moment it exists: HAIR gets the hair packs, every
// other family (OTHER included) gets the generic ones. The colour category is
// the one slug with its own intake pack, because its questions are about
// colour — that is a pack-registry fact, not a gate.

import type { ConsultServiceFamily, Prisma } from '@prisma/client'

import { resolveConsultCapturePack } from './capture/registry'
import type { ConsultCapturePackDefinition } from './capture/types'
import { resolveConsultIntakePack } from './intake/registry'
import type { ConsultIntakePackDefinition } from './intake/types'

/** Spread into any session select that needs to resolve a profile. */
export const CONSULT_SERVICE_PROFILE_CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  isActive: true,
  consultFamily: true,
} satisfies Prisma.ServiceCategorySelect

export type ConsultServiceProfileCategory = Prisma.ServiceCategoryGetPayload<{
  select: typeof CONSULT_SERVICE_PROFILE_CATEGORY_SELECT
}>

export type ConsultServiceProfile = {
  family: ConsultServiceFamily
  categoryId: string
  categorySlug: string
  categoryName: string
  intakePack: ConsultIntakePackDefinition
  capturePack: ConsultCapturePackDefinition
}

export function resolveConsultServiceProfile(
  category: ConsultServiceProfileCategory,
): ConsultServiceProfile {
  return {
    family: category.consultFamily,
    categoryId: category.id,
    categorySlug: category.slug,
    categoryName: category.name,
    intakePack: resolveConsultIntakePack({
      categorySlug: category.slug,
      family: category.consultFamily,
    }),
    capturePack: resolveConsultCapturePack({
      categorySlug: category.slug,
      family: category.consultFamily,
    }),
  }
}
