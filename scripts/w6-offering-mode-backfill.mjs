#!/usr/bin/env node
// scripts/w6-offering-mode-backfill.mjs
//
// W6 backfill — correct offerings whose in-salon flag was never a choice, and
// archive the placeholder salon locations that were auto-written to back that
// claim up.
//
// ⚠️ TOUCHES LIVE PRO DATA. It changes what real professionals advertise, so it
// is deliberately NOT a Prisma migration: migrations ride the deploy and run
// unattended. Run this by hand, read the dry run, and only then pass --apply.
//
//   node scripts/w6-offering-mode-backfill.mjs                 # dry run (default)
//   node scripts/w6-offering-mode-backfill.mjs --apply         # writes
//
// The DB comes from DIRECT_URL (or --url=…). Pointing it at prod is allowed —
// that is the point — but it prints the host and the row counts and refuses to
// write anything until --apply is passed.
//
// WHAT IT DOES
//
//   1. offersInSalon -> false for every ACTIVE offering whose pro has no
//      bookable, non-archived SALON/SUITE location. This is the same predicate
//      `loadProLocationCapability` uses at read time, so the stored flag simply
//      catches up with what clients are already being shown.
//
//   2. Skips (and reports) any offering where that would leave BOTH modes off.
//      An offering advertising nothing is worse than one advertising a mode it
//      cannot host — the pro has to make that call, not this script. These are
//      pros with no bookable location at all.
//
//   3. archivedAt on placeholder salon locations: SALON/SUITE, not bookable, no
//      address, no coordinates, and NOT referenced by any booking. Anything with
//      a reference is left alone.
//
// Everything is reported per-professional so the counts can be sanity-checked
// against a pro you know before --apply.

import { PrismaClient } from '@prisma/client'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const urlArg = args.find((a) => a.startsWith('--url='))

const url = urlArg ? urlArg.slice('--url='.length) : process.env.DIRECT_URL

if (!url) {
  console.error('No database URL. Set DIRECT_URL or pass --url=postgresql://…')
  process.exit(1)
}

function hostOf(connectionString) {
  try {
    return new URL(connectionString).host
  } catch {
    return '(unparseable)'
  }
}

const prisma = new PrismaClient({ datasources: { db: { url } } })

const SALON_TYPES = ['SALON', 'SUITE']

async function main() {
  console.log(`\nW6 offering-mode backfill`)
  console.log(`  host : ${hostOf(url)}`)
  console.log(`  mode : ${APPLY ? '🔴 APPLY (writes)' : 'dry run (no writes)'}\n`)

  // --- 1. Offerings claiming a salon their pro cannot host -------------------

  const salonClaims = await prisma.$queryRawUnsafe(`
    select o.id,
           o."professionalId",
           o."offersInSalon",
           o."offersMobile",
           s.name as service_name
    from "ProfessionalServiceOffering" o
    join "Service" s on s.id = o."serviceId"
    where o."isActive" = true
      and o."offersInSalon" = true
      and not exists (
        select 1 from "ProfessionalLocation" l
        where l."professionalId" = o."professionalId"
          and l."archivedAt" is null
          and l."isBookable" = true
          and l.type in (${SALON_TYPES.map((t) => `'${t}'`).join(',')})
      )
    order by o."professionalId", s.name
  `)

  const correctable = salonClaims.filter((row) => row.offersMobile === true)
  const wouldStrand = salonClaims.filter((row) => row.offersMobile !== true)

  console.log(`1. Offerings claiming in-salon with no bookable salon location`)
  console.log(`   total                : ${salonClaims.length}`)
  console.log(`   correctable          : ${correctable.length}  (pro also offers mobile)`)
  console.log(`   SKIPPED — would strand: ${wouldStrand.length}  (no mode would remain)`)

  const byPro = new Map()
  for (const row of correctable) {
    byPro.set(row.professionalId, (byPro.get(row.professionalId) ?? 0) + 1)
  }
  console.log(`   professionals affected: ${byPro.size}`)
  for (const [proId, n] of byPro) console.log(`     ${proId}  ${n} offering(s)`)

  if (wouldStrand.length > 0) {
    console.log(`\n   ⚠️ Skipped offerings (need a human decision — these pros have`)
    console.log(`      no bookable location of any kind):`)
    for (const row of wouldStrand) {
      console.log(`        ${row.professionalId}  ${row.id}  ${row.service_name}`)
    }
  }

  // --- 2. Placeholder salon locations ---------------------------------------

  const placeholders = await prisma.$queryRawUnsafe(`
    select l.id, l."professionalId", l.name
    from "ProfessionalLocation" l
    where l."archivedAt" is null
      and l."isBookable" = false
      and l.type in (${SALON_TYPES.map((t) => `'${t}'`).join(',')})
      and l."formattedAddress" is null
      and l.lat is null
      and l.lng is null
      and not exists (select 1 from "Booking" b where b."locationId" = l.id)
      and not exists (select 1 from "BookingHold" h where h."locationId" = l.id)
    order by l."professionalId"
  `)

  console.log(`\n2. Unreferenced placeholder salon locations to archive`)
  console.log(`   count: ${placeholders.length}`)
  for (const row of placeholders) {
    console.log(`     ${row.professionalId}  ${row.id}  ${JSON.stringify(row.name)}`)
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing written. Re-run with --apply to commit.\n`)
    return
  }

  // --- Apply ----------------------------------------------------------------

  const offeringIds = correctable.map((row) => row.id)
  const locationIds = placeholders.map((row) => row.id)

  const [offeringResult, locationResult] = await prisma.$transaction([
    // Flag only. The salon price/duration stay on the row deliberately: nothing
    // reads them while `offersInSalon` is false, and keeping them means a pro
    // who later opens a real salon gets their old numbers back instead of a
    // blank form. A backfill over live data should be reversible.
    prisma.professionalServiceOffering.updateMany({
      where: { id: { in: offeringIds } },
      data: { offersInSalon: false },
    }),
    prisma.professionalLocation.updateMany({
      where: { id: { in: locationIds } },
      data: { archivedAt: new Date() },
    }),
  ])

  console.log(`\n✅ Applied.`)
  console.log(`   offerings corrected : ${offeringResult.count}`)
  console.log(`   locations archived  : ${locationResult.count}`)
  console.log(`   offerings SKIPPED   : ${wouldStrand.length}  (listed above, untouched)`)
  console.log(
    `\n   Note: pro search index rows cache offering modes — run` +
      ` scripts/backfill-search-index.ts afterwards.\n`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
