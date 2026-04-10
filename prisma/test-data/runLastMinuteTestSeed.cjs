// prisma/test-data/runLastMinuteTestSeed.cjs
const { spawnSync } = require('child_process')
const path = require('path')

const scripts = [
  'createBaseClients.cjs',
  'seedTier1Waitlist.cjs',
  'seedTier2Reactivation.cjs',
  'seedTier3Discovery.cjs',
]

for (const script of scripts) {
  const fullPath = path.join(__dirname, script)
  console.log(`\n=== Running ${script} ===`)

  const result = spawnSync(process.execPath, [fullPath], {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('\nAll last-minute test seed scripts completed.')