// lib/privacy/professionalDisplayName.ts
import { Prisma, ProNameDisplay } from '@prisma/client'

export const professionalPublicDisplayNameSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    businessName: true,
    firstName: true,
    lastName: true,
    handle: true,
    nameDisplay: true,
  })

export type ProfessionalPublicDisplayNameSource = {
  businessName?: string | null
  firstName?: string | null
  lastName?: string | null
  handle?: string | null
  nameDisplay?: ProNameDisplay | null
} | null | undefined

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function businessNameOf(input: ProfessionalPublicDisplayNameSource): string | null {
  return trimToNull(input?.businessName)
}

function realNameOf(input: ProfessionalPublicDisplayNameSource): string | null {
  const personName = [trimToNull(input?.firstName), trimToNull(input?.lastName)]
    .filter(Boolean)
    .join(' ')
  return personName || null
}

function handleLabelOf(input: ProfessionalPublicDisplayNameSource): string | null {
  const handle = trimToNull(input?.handle)
  return handle ? `@${handle}` : null
}

/**
 * Resolve a pro's public display name, honoring their nameDisplay preference.
 * Each mode degrades to the other forms so the result is non-null whenever the
 * pro has a usable name token. BUSINESS_NAME (the default for legacy rows and
 * for callers that don't select nameDisplay) reproduces the historical
 * business-name-then-real-name behavior exactly — and never falls to the handle.
 */
export function pickProfessionalPublicDisplayName(
  input: ProfessionalPublicDisplayNameSource,
): string | null {
  const businessName = businessNameOf(input)
  const realName = realNameOf(input)
  const handleLabel = handleLabelOf(input)

  switch (input?.nameDisplay) {
    case ProNameDisplay.REAL_NAME:
      return realName ?? businessName ?? handleLabel
    case ProNameDisplay.HANDLE:
      return handleLabel ?? businessName ?? realName
    case ProNameDisplay.BUSINESS_NAME:
    default:
      return businessName ?? realName
  }
}

export function formatProfessionalPublicDisplayName(
  input: ProfessionalPublicDisplayNameSource,
  fallback = 'Professional',
): string {
  return pickProfessionalPublicDisplayName(input) ?? fallback
}

export function formatProfessionalPublicSearchText(
  input: ProfessionalPublicDisplayNameSource,
): string | null {
  const parts = [
    trimToNull(input?.businessName),
    trimToNull(input?.firstName),
    trimToNull(input?.lastName),
  ].filter(Boolean)

  return parts.length > 0 ? parts.join(' ') : null
}
