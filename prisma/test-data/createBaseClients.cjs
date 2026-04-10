// prisma/test-data/createBaseClients.cjs
const {
  prisma,
  LETTERS,
  TEST_PASSWORD,
  buildClientSeed,
  getPasswordHash,
  upsertClient,
  disconnect,
} = require('./_shared.cjs')

async function main() {
  const passwordHash = await getPasswordHash()
  const results = []

  for (const letter of LETTERS) {
    const seed = buildClientSeed(letter)
    const row = await upsertClient(prisma, {
      ...seed,
      passwordHash,
    })
    results.push({
      email: row.user.email,
      clientId: row.profile.id,
      userId: row.user.id,
    })
  }

  console.log('Created/updated base clients:')
  for (const row of results) {
    console.log(`${row.email} | password=${TEST_PASSWORD} | clientId=${row.clientId}`)
  }
}

main()
  .then(disconnect)
  .catch(async (error) => {
    console.error(error)
    await disconnect()
    process.exit(1)
  })