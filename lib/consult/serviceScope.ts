// lib/consult/serviceScope.ts
//
// WHICH SERVICE CATEGORIES the consult accepts. This is the only place that
// answers it; the anchor rules (eligibility.ts, anchor.ts, lookAnchor.ts) ask
// here instead of carrying a slug list each.
//
// Tori's 2026-09-03 decision: the consult runs for EVERY service, including
// categories that do not exist yet (docs/product/CONSULT-SERVICE-AWARE-PLAN.md).
// The intake, analysis and capture layers became service-aware first
// (tovis-app #1067, #1068, #1069); this default opened the gate last.
//
// `AI_CONSULT_SERVICE_SCOPE` is the kill switch: set it to HAIR_COLOR_ONLY and
// the consult narrows back to the colour category without a deploy — every
// other category's Book button falls through to the ordinary booking drawer,
// exactly as it did before the build. An unrecognised value is ignored, never
// treated as "open".

import { ConsultServiceFamily } from '@prisma/client'

export const CONSULT_SERVICE_SCOPES = ['HAIR_COLOR_ONLY', 'ALL_SERVICES'] as const

export type ConsultServiceScope = (typeof CONSULT_SERVICE_SCOPES)[number]

export const CONSULT_SERVICE_SCOPE_DEFAULT: ConsultServiceScope = 'ALL_SERVICES'

/** The one category slug the NARROWED (kill-switch) scope admits. */
export const HAIR_COLOR_CATEGORY_SLUG = 'hair-color'

export function consultServiceScope(): ConsultServiceScope {
  const raw = process.env.AI_CONSULT_SERVICE_SCOPE?.trim()
  const override = CONSULT_SERVICE_SCOPES.find((scope) => scope === raw)
  return override ?? CONSULT_SERVICE_SCOPE_DEFAULT
}

/**
 * Is a service category inside the consult's scope? Under ALL_SERVICES every
 * category with a slug qualifies — activeness is checked where the category
 * row is actually loaded, not here.
 */
export function isConsultCategoryInScope(category: {
  slug: string | null | undefined
}): boolean {
  const slug = category.slug?.trim()
  if (!slug) return false
  return consultServiceScope() === 'ALL_SERVICES' || slug === HAIR_COLOR_CATEGORY_SLUG
}

/**
 * Every family the schema knows, in display order. Kept beside the scope so a
 * new family is added in ONE place (the Prisma enum) and this list, which the
 * admin form and the intake registry both read, cannot drift from it.
 */
export const CONSULT_SERVICE_FAMILIES: readonly ConsultServiceFamily[] = [
  ConsultServiceFamily.HAIR,
  ConsultServiceFamily.SKIN,
  ConsultServiceFamily.NAILS,
  ConsultServiceFamily.BROWS_LASHES,
  ConsultServiceFamily.MAKEUP,
  ConsultServiceFamily.BODY,
  ConsultServiceFamily.OTHER,
]

export const CONSULT_SERVICE_FAMILY_LABELS: Readonly<
  Record<ConsultServiceFamily, string>
> = {
  HAIR: 'Hair',
  SKIN: 'Skin',
  NAILS: 'Nails',
  BROWS_LASHES: 'Brows & lashes',
  MAKEUP: 'Makeup',
  BODY: 'Body',
  OTHER: 'Other',
}

export function parseConsultServiceFamily(
  value: unknown,
): ConsultServiceFamily | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return CONSULT_SERVICE_FAMILIES.find((family) => family === trimmed) ?? null
}
