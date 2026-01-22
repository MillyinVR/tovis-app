// app/pro/locations/page.tsx

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import LocationsClient from './LocationsClient'

export const dynamic = 'force-dynamic'

export default async function ProLocationsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'PRO' || !user.professionalProfile?.id) redirect('/login?from=/pro/locations')

  const professionalId = user.professionalProfile.id

  const locations = await prisma.professionalLocation.findMany({
    where: { professionalId },
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
      createdAt: true,
    },
    take: 100,
  })

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 1000 }}>Locations</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: 13, lineHeight: 1.4 }}>
          Real addresses, real maps, real “near me” discovery. Revolutionary concept.
        </p>
      </div>

      <LocationsClient
        initialLocations={locations.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))}
      />
    </div>
  )
}
