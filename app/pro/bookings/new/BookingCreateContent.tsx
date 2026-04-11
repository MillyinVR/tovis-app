// app/pro/bookings/new/BookingCreateContent.tsx
import { redirect } from 'next/navigation'
import {
  ClientAddressKind,
  ProfessionalLocationType,
  Role,
} from '@prisma/client'

import { getCurrentUser } from '@/lib/currentUser'
import {
  buildProBookingNewClientDTO,
  buildProBookingNewOfferingDTO,
} from '@/lib/dto/proBookingNew'
import { getProClientVisibility } from '@/lib/clientVisibility'
import { prisma } from '@/lib/prisma'

import NewBookingForm from './NewBookingForm'

export type BookingCreateSearchParams = {
  clientId?: string
  offeringId?: string
  locationId?: string
  locationType?: string
  scheduledAt?: string
}

type ClientAddressOption = {
  id: string
  label: string
  formattedAddress: string
  isDefault: boolean
}

type ClientAddressesByClientId = Record<string, ClientAddressOption[]>

type BookableLocationOption = {
  id: string
  label: string
  type: 'SALON' | 'SUITE' | 'MOBILE_BASE'
  isBookable: boolean
  isPrimary: boolean
  timeZone: string | null
}

type ServiceLocationType = 'SALON' | 'MOBILE'

function normalizeSearchParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeLocationTypeParam(
  value: unknown,
): ServiceLocationType | undefined {
  const normalized = normalizeSearchParam(value)?.toUpperCase()
  if (normalized === 'SALON') return 'SALON'
  if (normalized === 'MOBILE') return 'MOBILE'
  return undefined
}

function normalizeDatetimeLocalParam(value: unknown): string | undefined {
  const raw = normalizeSearchParam(value)
  if (!raw) return undefined
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? raw : undefined
}

function buildLocationLabel(location: {
  type: ProfessionalLocationType
  formattedAddress: string | null
  city: string | null
  isPrimary: boolean
}) {
  const modeLabel =
    location.type === ProfessionalLocationType.MOBILE_BASE
      ? 'Mobile base'
      : location.type === ProfessionalLocationType.SUITE
        ? 'Suite'
        : 'Salon'

  const place =
    (typeof location.formattedAddress === 'string' &&
      location.formattedAddress.trim()) ||
    (typeof location.city === 'string' && location.city.trim()) ||
    ''

  const primary = location.isPrimary ? ' • Primary' : ''

  return place ? `${modeLabel} • ${place}${primary}` : `${modeLabel}${primary}`
}

function buildClientAddressesByClientId(
  rows: Array<{
    clientId: string
    id: string
    label: string | null
    formattedAddress: string | null
    isDefault: boolean
  }>,
): ClientAddressesByClientId {
  const grouped: ClientAddressesByClientId = {}

  for (const row of rows) {
    const clientId = typeof row.clientId === 'string' ? row.clientId.trim() : ''
    const id = typeof row.id === 'string' ? row.id.trim() : ''
    const formattedAddress =
      typeof row.formattedAddress === 'string'
        ? row.formattedAddress.trim()
        : ''

    if (!clientId || !id || !formattedAddress) continue

    const label =
      typeof row.label === 'string' && row.label.trim()
        ? row.label.trim()
        : 'Service address'

    if (!grouped[clientId]) grouped[clientId] = []

    grouped[clientId].push({
      id,
      label,
      formattedAddress,
      isDefault: Boolean(row.isDefault),
    })
  }

  for (const clientId of Object.keys(grouped)) {
    grouped[clientId].sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return a.label.localeCompare(b.label)
    })
  }

  return grouped
}

function locationTypeFromLocation(
  location: Pick<BookableLocationOption, 'type'> | null | undefined,
): ServiceLocationType | undefined {
  if (!location) return undefined
  return location.type === 'MOBILE_BASE' ? 'MOBILE' : 'SALON'
}

export default async function BookingCreateContent(props: {
  searchParams: BookingCreateSearchParams
  isModal?: boolean
}) {
  const { searchParams, isModal = false } = props

  const requestedClientId = normalizeSearchParam(searchParams.clientId)
  const requestedOfferingId = normalizeSearchParam(searchParams.offeringId)
  const requestedLocationId = normalizeSearchParam(searchParams.locationId)
  const requestedLocationType = normalizeLocationTypeParam(
    searchParams.locationType,
  )
  const defaultScheduledAt = normalizeDatetimeLocalParam(
    searchParams.scheduledAt,
  )

  const user = await getCurrentUser()

  if (!user || user.role !== Role.PRO || !user.professionalProfile?.id) {
    redirect('/login?from=/pro/bookings/new')
  }

  const professionalId = user.professionalProfile.id

  const [offeringsRaw, locationsRaw] = await Promise.all([
    prisma.professionalServiceOffering.findMany({
      where: {
        professionalId,
        isActive: true,
      },
      select: {
        id: true,
        title: true,
        description: true,
        salonPriceStartingAt: true,
        salonDurationMinutes: true,
        mobilePriceStartingAt: true,
        mobileDurationMinutes: true,
        offersInSalon: true,
        offersMobile: true,
        customImageUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        service: {
          select: {
            id: true,
            name: true,
            categoryId: true,
            description: true,
            defaultDurationMinutes: true,
            minPrice: true,
            defaultImageUrl: true,
            allowMobile: true,
            isActive: true,
            isAddOnEligible: true,
            addOnGroup: true,
            category: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        service: {
          name: 'asc',
        },
      },
    }),

    prisma.professionalLocation.findMany({
      where: {
        professionalId,
        isBookable: true,
        type: {
          in: [
            ProfessionalLocationType.SALON,
            ProfessionalLocationType.SUITE,
            ProfessionalLocationType.MOBILE_BASE,
          ],
        },
      },
      select: {
        id: true,
        type: true,
        isBookable: true,
        isPrimary: true,
        timeZone: true,
        city: true,
        formattedAddress: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    }),
  ])

  const offerings = offeringsRaw.map(buildProBookingNewOfferingDTO)

  const locations: BookableLocationOption[] = locationsRaw.map((location) => ({
    id: location.id,
    label: buildLocationLabel(location),
    type: location.type,
    isBookable: location.isBookable,
    isPrimary: location.isPrimary,
    timeZone: location.timeZone,
  }))

  let clients: ReturnType<typeof buildProBookingNewClientDTO>[] = []
  let clientAddressesByClientId: ClientAddressesByClientId = {}
  let validClientId: string | undefined

  if (requestedClientId) {
    const requestedClient = await prisma.clientProfile.findUnique({
      where: { id: requestedClientId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        dateOfBirth: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            phone: true,
            phoneVerifiedAt: true,
          },
        },
      },
    })

    if (requestedClient) {
      const visibility = await getProClientVisibility(
        professionalId,
        requestedClient.id,
      )

      if (visibility.canViewClient) {
        clients = [buildProBookingNewClientDTO(requestedClient)]
        validClientId = requestedClient.id

        const clientAddressesRaw = await prisma.clientAddress.findMany({
          where: {
            clientId: requestedClient.id,
            kind: ClientAddressKind.SERVICE_ADDRESS,
          },
          select: {
            id: true,
            clientId: true,
            label: true,
            formattedAddress: true,
            isDefault: true,
          },
          orderBy: [
            { isDefault: 'desc' },
            { updatedAt: 'desc' },
            { createdAt: 'asc' },
          ],
        })

        clientAddressesByClientId =
          buildClientAddressesByClientId(clientAddressesRaw)
      }
    }
  }

  const validOfferingId = offerings.some(
    (offering) => offering.id === requestedOfferingId,
  )
    ? requestedOfferingId
    : undefined

  const validLocation =
    locations.find((location) => location.id === requestedLocationId) ?? null

  const validLocationId = validLocation?.id
  const derivedLocationType = locationTypeFromLocation(validLocation)

  const validLocationType =
    validLocationId != null ? derivedLocationType : requestedLocationType

  return (
    <NewBookingForm
      clients={clients}
      offerings={offerings}
      locations={locations}
      clientAddressesByClientId={clientAddressesByClientId}
      defaultClientId={validClientId}
      defaultOfferingId={validOfferingId}
      defaultLocationId={validLocationId}
      defaultLocationType={validLocationType}
      defaultScheduledAt={defaultScheduledAt}
      cancelHref="/pro/bookings"
      cancelMode={isModal ? 'back' : 'href'}
    />
  )
}