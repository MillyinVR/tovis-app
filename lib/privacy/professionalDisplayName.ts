// lib/privacy/professionalDisplayName.ts
import { Prisma } from '@prisma/client'

export const professionalPublicDisplayNameSelect =
  Prisma.validator<Prisma.ProfessionalProfileSelect>()({
    businessName: true,
    firstName: true,
    lastName: true,
  })

export type ProfessionalPublicDisplayNameSource = {
  businessName?: string | null
  firstName?: string | null
  lastName?: string | null
} | null | undefined

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

export function pickProfessionalPublicDisplayName(
  input: ProfessionalPublicDisplayNameSource,
): string | null {
  const businessName = trimToNull(input?.businessName)
  if (businessName) return businessName

  const personName = [trimToNull(input?.firstName), trimToNull(input?.lastName)]
    .filter(Boolean)
    .join(' ')

  return personName || null
}

export function formatProfessionalPublicDisplayName(
  input: ProfessionalPublicDisplayNameSource,
  fallback = 'Beauty professional',
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
