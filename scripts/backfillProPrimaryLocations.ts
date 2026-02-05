import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type Candidate = {
  id: string
  professionalId: string
  isPrimary: boolean
  lat: any
  lng: any
  updatedAt: Date
  createdAt: Date
  city: string | null
  state: string | null
  formattedAddress: string | null
  timeZone: string | null
}

/**
 * Picks the "best" primary location for a pro:
 * 1) existing primary WITH coords
 * 2) any location WITH coords (most recently updated)
 * 3) existing primary (even without coords)
 * 4) most recent location
 */
function pickBest(locations: Candidate[]): Candidate | null {
  if (!locations.length) return null

  const withCoords = (l: Candidate) => l.lat != null && l.lng != null

  const primWithCoords = locations.filter((l) => l.isPrimary && withCoords(l))
  if (primWithCoords.length) return primWithCoords.sort((a, b) => +b.updatedAt - +a.updatedAt)[0]

  const anyWithCoords = locations.filter(withCoords)
  if (anyWithCoords.length) return anyWithCoords.sort((a, b) => +b.updatedAt - +a.updatedAt)[0]

  const prim = locations.filter((l) => l.isPrimary)
  if (prim.length) return prim.sort((a, b) => +b.updatedAt - +a.updatedAt)[0]

  return locations.sort((a, b) => +b.updatedAt - +a.updatedAt)[0]
}

async function main() {
  const pros = await prisma.professionalProfile.findMany({
    select: {
      id: true,
      location: true,
      timeZone: true,
      locations: {
        select: {
          id: true,
          professionalId: true,
          isPrimary: true,
          lat: true,
          lng: true,
          updatedAt: true,
          createdAt: true,
          city: true,
          state: true,
          formattedAddress: true,
          timeZone: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      },
    },
  })

  let changed = 0
  let flaggedMissingCoords = 0
  let noLocations = 0

  for (const pro of pros) {
    const locations = pro.locations as unknown as Candidate[]

    if (!locations.length) {
      noLocations++
      continue
    }

    const best = pickBest(locations)
    if (!best) continue

    const primaryIds = locations.filter((l) => l.isPrimary).map((l) => l.id)
    const hasExactlyOnePrimary = primaryIds.length === 1 && primaryIds[0] === best.id

    const bestHasCoords = best.lat != null && best.lng != null

    // If best isn't the only primary, normalize primaries
    if (!hasExactlyOnePrimary) {
      await prisma.$transaction([
        prisma.professionalLocation.updateMany({
          where: { professionalId: pro.id, isPrimary: true },
          data: { isPrimary: false },
        }),
        prisma.professionalLocation.update({
          where: { id: best.id },
          data: { isPrimary: true },
        }),
      ])
      changed++
    }

    // Optional niceties:
    // - If pro.location is empty, fill it from primary city/state
    const proLocEmpty = !pro.location || !pro.location.trim()
    const cityState =
      best.city?.trim()
        ? `${best.city.trim()}${best.state?.trim() ? `, ${best.state.trim()}` : ''}`
        : null

    // - If pro.timeZone missing but primary has one, copy it
    const needsTz = !pro.timeZone && best.timeZone

    if (proLocEmpty || needsTz) {
      await prisma.professionalProfile.update({
        where: { id: pro.id },
        data: {
          ...(proLocEmpty && cityState ? { location: cityState } : {}),
          ...(needsTz ? { timeZone: best.timeZone } : {}),
        },
      })
    }

    // Flag: primary exists but still missing coords (you'll want onboarding to fix this)
    if (!bestHasCoords) flaggedMissingCoords++
  }

  console.log('✅ Backfill complete')
  console.log(`- Pros updated (primary normalized): ${changed}`)
  console.log(`- Pros with NO locations: ${noLocations}`)
  console.log(`- Pros whose chosen primary still missing coords: ${flaggedMissingCoords}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
