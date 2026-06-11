// app/pro/locations/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import LocationsClient from './LocationsClient'
import {
  parseLocationType,
  type ProLocation,
} from '@/lib/contracts/proLocations'

export const dynamic = 'force-dynamic'

function decimalToNumberOrNull(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null

  if (
    typeof v === 'object' &&
    typeof (v as { toNumber?: unknown }).toNumber === 'function'
  ) {
    const n = (v as { toNumber: () => number }).toNumber()
    return Number.isFinite(n) ? n : null
  }

  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  return null
}

export default async function ProLocationsPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/locations')
  }

  const profile = await prisma.professionalProfile.findUnique({
    where: { id: user.professionalProfile.id },
    select: { mobileRadiusMiles: true },
  })

  const rows = await prisma.professionalLocation.findMany({
    where: { professionalId: user.professionalProfile.id },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      type: true,
      name: true,
      isPrimary: true,
      isBookable: true,
      formattedAddress: true,
      city: true,
      state: true,
      postalCode: true,
      countryCode: true,
      placeId: true,
      lat: true,
      lng: true,
      timeZone: true,
      advanceNoticeMinutes: true,
      createdAt: true,
    },
    take: 100,
  })

  const initialLocations: ProLocation[] = rows.map((r) => ({
    id: r.id,
    type: parseLocationType(r.type),
    name: r.name,
    isPrimary: r.isPrimary,
    isBookable: r.isBookable,
    formattedAddress: r.formattedAddress,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    countryCode: r.countryCode,
    placeId: r.placeId,
    lat: decimalToNumberOrNull(r.lat),
    lng: decimalToNumberOrNull(r.lng),
    timeZone: r.timeZone,
    advanceNoticeMinutes: r.advanceNoticeMinutes ?? 15,
    createdAt: r.createdAt.toISOString(),
  }))

  return (
    <LocationsClient
      initialLocations={initialLocations}
      initialMobileRadiusMiles={profile?.mobileRadiusMiles ?? null}
    />
  )
}
