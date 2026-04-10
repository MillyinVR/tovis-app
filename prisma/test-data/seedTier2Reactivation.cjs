// prisma/test-data/seedTier2Reactivation.cjs
const {
  prisma,
  getClientByLetter,
  upsertProfessionalFavorite,
  createPastBooking,
  createFutureBooking,
  requireEnv,
  disconnect,
} = require('./_shared.cjs')

async function main() {
  const professionalId = requireEnv('LM_PROFESSIONAL_ID')
  const serviceId = requireEnv('LM_SERVICE_ID')
  const offeringId = requireEnv('LM_OFFERING_ID')
  const locationId = requireEnv('LM_LOCATION_ID')
  const locationType = requireEnv('LM_LOCATION_TYPE')

  const clientD = await getClientByLetter(prisma, 'D')
  const clientE = await getClientByLetter(prisma, 'E')
  const clientF = await getClientByLetter(prisma, 'F')
  const clientG = await getClientByLetter(prisma, 'G')

  await createPastBooking(prisma, {
    clientId: clientD.clientId,
    professionalId,
    serviceId,
    offeringId,
    locationId,
    locationType,
    scheduledFor: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000),
  })

  await upsertProfessionalFavorite(prisma, {
    professionalId,
    userId: clientE.userId,
  })

  await createPastBooking(prisma, {
    clientId: clientF.clientId,
    professionalId,
    serviceId,
    offeringId,
    locationId,
    locationType,
    scheduledFor: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
  })

  await upsertProfessionalFavorite(prisma, {
    professionalId,
    userId: clientG.userId,
  })

  await createFutureBooking(prisma, {
    clientId: clientG.clientId,
    professionalId,
    serviceId,
    offeringId,
    locationId,
    locationType,
    scheduledFor: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
  })

  console.log('Seeded Tier 2 reactivation test data:')
  console.log('D = should qualify by lapse')
  console.log('E = should qualify by pro favorite')
  console.log('F = should fail because last booking is too recent')
  console.log('G = should fail because future booking exists')
}

main()
  .then(disconnect)
  .catch(async (error) => {
    console.error(error)
    await disconnect()
    process.exit(1)
  })