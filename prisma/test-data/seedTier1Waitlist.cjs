// prisma/test-data/seedTier1Waitlist.cjs
const {
  prisma,
  getClientByLetter,
  upsertWaitlistEntry,
  createFutureBooking,
  requireEnv,
  WaitlistPreferenceType,
  disconnect,
} = require('./_shared.cjs')

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000)
}

async function main() {
  const professionalId = requireEnv('LM_PROFESSIONAL_ID')
  const serviceId = requireEnv('LM_SERVICE_ID')
  const offeringId = requireEnv('LM_OFFERING_ID')
  const locationId = requireEnv('LM_LOCATION_ID')
  const locationType = requireEnv('LM_LOCATION_TYPE')

  const clientA = await getClientByLetter(prisma, 'A')
  const clientB = await getClientByLetter(prisma, 'B')
  const clientC = await getClientByLetter(prisma, 'C')

  // A: positive control
  await upsertWaitlistEntry(prisma, {
    clientId: clientA.clientId,
    professionalId,
    serviceId,
    preferenceType: WaitlistPreferenceType.ANY_TIME,
    notes: 'Tier 1 positive control',
  })

  // B: negative control
  // Use a clearly different future calendar date so timezone conversion
  // cannot accidentally collapse it onto the opening’s local day.
  await upsertWaitlistEntry(prisma, {
    clientId: clientB.clientId,
    professionalId,
    serviceId,
    preferenceType: WaitlistPreferenceType.SPECIFIC_DATE,
    specificDate: daysFromNow(30),
    notes: 'Tier 1 negative control: wrong specific date',
  })

  // C: negative control via future booking exclusion
  await upsertWaitlistEntry(prisma, {
    clientId: clientC.clientId,
    professionalId,
    serviceId,
    preferenceType: WaitlistPreferenceType.ANY_TIME,
    notes: 'Tier 1 negative control: future booking exclusion',
  })

  await createFutureBooking(prisma, {
    clientId: clientC.clientId,
    professionalId,
    serviceId,
    offeringId,
    locationId,
    locationType,
    scheduledFor: daysFromNow(14),
  })

  console.log('Seeded Tier 1 waitlist test data:')
  console.log('A = should qualify')
  console.log('B = should fail preference match')
  console.log('C = should fail because future booking exists')
}

main()
  .then(disconnect)
  .catch(async (error) => {
    console.error(error)
    await disconnect()
    process.exit(1)
  })