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

/**
 * P7a-4 — how long before the appointment the safety answers must be in.
 *
 * Per category config, keyed on the family like everything else on the
 * profile, so a new category resolves the moment it exists. Hair is 48 hours
 * because that is the working window a colourist needs: an answer that arrives
 * the night before is an answer that arrives too late to order anything, move
 * anything, or book the patch test the answer might require
 * (lib/consult/safetyRouting.ts). Every other family inherits the same default
 * until P11 gives it its own — a category config with no entry must not mean
 * "no deadline".
 */
const CONSULT_PREP_DEADLINE_HOURS_BY_FAMILY: Readonly<
  Record<ConsultServiceFamily, number>
> = {
  HAIR: 48,
  NAILS: 48,
  SKIN: 48,
  BROWS_LASHES: 48,
  MAKEUP: 48,
  BODY: 48,
  OTHER: 48,
}

/** The default a family with no entry of its own falls back to. */
export const CONSULT_PREP_DEADLINE_DEFAULT_HOURS = 48

export function resolveConsultPrepDeadlineHours(
  family: ConsultServiceFamily,
): number {
  return (
    CONSULT_PREP_DEADLINE_HOURS_BY_FAMILY[family] ??
    CONSULT_PREP_DEADLINE_DEFAULT_HOURS
  )
}

export type ConsultServiceProfile = {
  family: ConsultServiceFamily
  categoryId: string
  categorySlug: string
  categoryName: string
  intakePack: ConsultIntakePackDefinition
  capturePack: ConsultCapturePackDefinition
  /** P7a-4: hours before the appointment the safety answers are due. */
  prepDeadlineHours: number
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
    prepDeadlineHours: resolveConsultPrepDeadlineHours(category.consultFamily),
  }
}
