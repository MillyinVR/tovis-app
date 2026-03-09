// lib/dto/proBookingNew.ts
import type { Prisma, Role } from '@prisma/client'

function decimalToNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number | null {
  if (value == null) return null

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }

  const n = Number(value.toString())
  return Number.isFinite(n) ? n : null
}

function dateToIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export type ProBookingNewClientDTO = {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  avatarUrl: string | null
  dateOfBirth: string | null
  user: {
    id: string
    email: string
    role: Role
    phone: string | null
    phoneVerifiedAt: string | null
  } | null
}

export type ProBookingNewOfferingDTO = {
  id: string
  title: string | null
  description: string | null
  salonPriceStartingAt: number | null
  salonDurationMinutes: number | null
  mobilePriceStartingAt: number | null
  mobileDurationMinutes: number | null
  offersInSalon: boolean
  offersMobile: boolean
  customImageUrl: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  service: {
    id: string
    name: string
    categoryId: string | null
    description: string | null
    defaultDurationMinutes: number | null
    minPrice: number | null
    defaultImageUrl: string | null
    allowMobile: boolean
    isActive: boolean
    isAddOnEligible: boolean
    addOnGroup: string | null
    category: {
      id: string
      name: string
    } | null
  }
}

export type ProBookingNewClientRow = {
  id: string
  firstName: string
  lastName: string
  phone: string | null
  avatarUrl: string | null
  dateOfBirth: Date | null
  user: {
    id: string
    email: string
    role: Role
    phone: string | null
    phoneVerifiedAt: Date | null
  } | null
}

export type ProBookingNewOfferingRow = {
  id: string
  title: string | null
  description: string | null
  salonPriceStartingAt: Prisma.Decimal | null
  salonDurationMinutes: number | null
  mobilePriceStartingAt: Prisma.Decimal | null
  mobileDurationMinutes: number | null
  offersInSalon: boolean
  offersMobile: boolean
  customImageUrl: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  service: {
    id: string
    name: string
    categoryId: string | null
    description: string | null
    defaultDurationMinutes: number | null
    minPrice: Prisma.Decimal | null
    defaultImageUrl: string | null
    allowMobile: boolean
    isActive: boolean
    isAddOnEligible: boolean
    addOnGroup: string | null
    category: {
      id: string
      name: string
    } | null
  }
}

export function buildProBookingNewClientDTO(
  row: ProBookingNewClientRow,
): ProBookingNewClientDTO {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone ?? null,
    avatarUrl: row.avatarUrl ?? null,
    dateOfBirth: dateToIso(row.dateOfBirth),
    user: row.user
      ? {
          id: row.user.id,
          email: row.user.email,
          role: row.user.role,
          phone: row.user.phone ?? null,
          phoneVerifiedAt: dateToIso(row.user.phoneVerifiedAt),
        }
      : null,
  }
}

export function buildProBookingNewOfferingDTO(
  row: ProBookingNewOfferingRow,
): ProBookingNewOfferingDTO {
  return {
    id: row.id,
    title: row.title ?? null,
    description: row.description ?? null,
    salonPriceStartingAt: decimalToNumber(row.salonPriceStartingAt),
    salonDurationMinutes: row.salonDurationMinutes ?? null,
    mobilePriceStartingAt: decimalToNumber(row.mobilePriceStartingAt),
    mobileDurationMinutes: row.mobileDurationMinutes ?? null,
    offersInSalon: row.offersInSalon,
    offersMobile: row.offersMobile,
    customImageUrl: row.customImageUrl ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    service: {
      id: row.service.id,
      name: row.service.name,
      categoryId: row.service.categoryId ?? null,
      description: row.service.description ?? null,
      defaultDurationMinutes: row.service.defaultDurationMinutes ?? null,
      minPrice: decimalToNumber(row.service.minPrice),
      defaultImageUrl: row.service.defaultImageUrl ?? null,
      allowMobile: row.service.allowMobile,
      isActive: row.service.isActive,
      isAddOnEligible: row.service.isAddOnEligible,
      addOnGroup: row.service.addOnGroup ?? null,
      category: row.service.category
        ? {
            id: row.service.category.id,
            name: row.service.category.name,
          }
        : null,
    },
  }
}