// prisma/test-data/seedTier3Discovery.cjs
const {
  prisma,
  getClientByLetter,
  upsertSearchArea,
  createIntentEvent,
  upsertServiceFavorite,
  upsertProfessionalFavorite,
  requireEnv,
  parseNumberEnv,
  ClientIntentType,
  disconnect,
} = require('./_shared.cjs')

async function main() {
  const professionalId = requireEnv('LM_PROFESSIONAL_ID')
  const serviceId = requireEnv('LM_SERVICE_ID')
  const offeringId = requireEnv('LM_OFFERING_ID')

  const salonLat = parseNumberEnv('LM_LOCATION_LAT')
  const salonLng = parseNumberEnv('LM_LOCATION_LNG')

  if (salonLat == null || salonLng == null) {
    throw new Error('LM_LOCATION_LAT and LM_LOCATION_LNG are required for discovery seeding')
  }

  const clientH = await getClientByLetter(prisma, 'H')
  const clientI = await getClientByLetter(prisma, 'I')
  const clientJ = await getClientByLetter(prisma, 'J')
  const clientK = await getClientByLetter(prisma, 'K')

  await upsertSearchArea(prisma, {
    clientId: clientH.clientId,
    label: 'Client H search area',
    lat: salonLat,
    lng: salonLng,
    radiusMiles: 10,
  })

  await createIntentEvent(prisma, {
    clientId: clientH.clientId,
    type: ClientIntentType.VIEW_PRO,
    professionalId,
    source: 'DISCOVERY',
  })

  await upsertSearchArea(prisma, {
    clientId: clientI.clientId,
    label: 'Client I search area',
    lat: salonLat,
    lng: salonLng,
    radiusMiles: 10,
  })

  await upsertServiceFavorite(prisma, {
    serviceId,
    userId: clientI.userId,
  })

  await createIntentEvent(prisma, {
    clientId: clientI.clientId,
    type: ClientIntentType.VIEW_OFFERING,
    offeringId,
    source: 'DISCOVERY',
  })

  await upsertSearchArea(prisma, {
    clientId: clientJ.clientId,
    label: 'Client J search area',
    lat: salonLat,
    lng: salonLng,
    radiusMiles: 10,
  })

  await upsertProfessionalFavorite(prisma, {
    professionalId,
    userId: clientJ.userId,
  })

  await createIntentEvent(prisma, {
    clientId: clientJ.clientId,
    type: ClientIntentType.VIEW_SERVICE,
    serviceId,
    source: 'DISCOVERY',
  })

  await upsertSearchArea(prisma, {
    clientId: clientK.clientId,
    label: 'Client K search area',
    lat: salonLat + 3,
    lng: salonLng + 3,
    radiusMiles: 5,
  })

  await createIntentEvent(prisma, {
    clientId: clientK.clientId,
    type: ClientIntentType.VIEW_PRO,
    professionalId,
    source: 'DISCOVERY',
  })

  console.log('Seeded Tier 3 discovery test data:')
  console.log('H = should qualify by intent + radius')
  console.log('I = should qualify by service favorite + radius')
  console.log('J = should be excluded from Tier 3 because pro favorite belongs to Tier 2')
  console.log('K = should fail because search area is outside radius')
}

main()
  .then(disconnect)
  .catch(async (error) => {
    console.error(error)
    await disconnect()
    process.exit(1)
  })