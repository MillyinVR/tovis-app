#!/usr/bin/env node
// scripts/preflight-w7-navigate-impact.mjs
//
// READ-ONLY. W7 defaults `isAddressPublic` to false for EVERY location, so the
// Discover "Navigate" button disappears for every pro until they opt in. That is
// intended — the button was routing to a coarsened point, i.e. the wrong address
// — but it is a visible removal, so the size of it should be known before deploy
// rather than guessed.
//
//   node scripts/preflight-w7-navigate-impact.mjs

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const raw = readFileSync('.env.local', 'utf8')
const m = raw.match(/^DIRECT_URL="?([^"\n]+)"?$/m)
if (!m) throw new Error('No DIRECT_URL in .env.local')

const prisma = new PrismaClient({ datasources: { db: { url: m[1] } } })

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    select
      type::text as type,
      count(*)::int as total,
      count(*) filter (where "isBookable")::int as bookable,
      count(*) filter (where "formattedAddress" is not null)::int as with_address,
      count(*) filter (where "isBookable" and "formattedAddress" is not null)::int as publishable_if_opted_in
    from "ProfessionalLocation"
    where "archivedAt" is null
    group by 1
    order by 1
  `)

  console.log('\nW7 — locations that COULD show Navigate once a pro opts in\n')
  console.log('  type          total  bookable  w/address  publishable')
  for (const r of rows) {
    console.log(
      `  ${r.type.padEnd(12)} ${String(r.total).padStart(5)} ${String(r.bookable).padStart(9)} ${String(r.with_address).padStart(10)} ${String(r.publishable_if_opted_in).padStart(12)}`,
    )
  }

  const salon = rows
    .filter((r) => r.type === 'SALON' || r.type === 'SUITE')
    .reduce((n, r) => n + r.publishable_if_opted_in, 0)

  console.log(
    `\n  Salon-type locations eligible to publish: ${salon}` +
      `\n  (a MOBILE_BASE is never publishable, whatever the flag says)\n` +
      `\n  On deploy ALL of these show no Navigate button until the pro turns the` +
      `\n  toggle on in /pro/locations. Before this change they showed a Navigate` +
      `\n  button pointing at a ~1.1km-coarsened point — i.e. the wrong door.\n`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
