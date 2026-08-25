// scripts/migration-drive/renameImportIdempotencyKeys.mjs
//
// ONE-TIME cutover for the pro-scoped calendar-import idempotency key
// (OPEN-WORK item 1). The importer's `importKey()` changed from
// `import:<uid>` to `import:<professionalId>:<uid>`. Bookmarks written under
// the OLD name would stop matching after deploy, so the hourly resync would
// re-import every already-imported feed once — a wave of duplicate
// "needs review" entries. This script renames every existing bookmark to the
// new scheme, in place.
//
// Run it ONCE, in the deploy window, AFTER the code change is deployed and
// BEFORE any pro runs an import against new code (order within the window does
// not matter as long as no import runs between deploy and rename; if one did,
// just re-run this script — it is idempotent).
//
// Safety rails (mirrors cleanupRemoteMigRows.mjs):
//   - SELECT first, print everything it will touch.
//   - Only rows whose key matches the EXACT old shape are renamed. A row whose
//     key already contains its own professionalId is left alone (idempotent),
//   - refuses to run unless `--yes` is passed after the dry-run preview,
//   - refuses to run against a DATABASE_URL that looks like production
//     (prod imports must go through Tori explicitly).
//
// Usage:
//   node scripts/migration-drive/renameImportIdempotencyKeys.mjs          # dry run
//   node scripts/migration-drive/renameImportIdempotencyKeys.mjs --yes    # apply

import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

// Point Prisma's datasource at .env.local's URL, whatever the ambient env says
// (same precedence cleanupRemoteMigRows.mjs relies on under tsx/node here).
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*DATABASE_URL="?([^"\r\n]+)"?\s*$/)
  if (m) {
    process.env.DATABASE_URL = m[1]
    break
  }
}

const prisma = new PrismaClient()

const url = process.env.DATABASE_URL ?? ''
if (/postgres(ql)?:\/\/[^/]*:(\d+)\./.test(url)) {
  console.error(
    'ABORT: DATABASE_URL looks like a hosted production endpoint. ' +
      'Prod renames go through Tori explicitly.',
  )
  await prisma.$disconnect()
  process.exit(1)
}

const APPLY = process.argv.includes('--yes')

const candidates = await prisma.booking.findMany({
  where: { creationIdempotencyKey: { startsWith: 'import:' } },
  select: { id: true, professionalId: true, creationIdempotencyKey: true },
  orderBy: { createdAt: 'asc' },
})

// Only the OLD shape needs renaming. New-shape keys embed their professionalId;
// uid values may themselves contain colons, so match on the prefix + remainder,
// not on segment count.
const stale = candidates.filter((b) => {
  const rest = b.creationIdempotencyKey.slice('import:'.length)
  return !rest.startsWith(`${b.professionalId}:`)
})

console.log(`import-keyed bookings found: ${candidates.length}`)
console.log(`stale (old-shape) keys to rename: ${stale.length}`)

if (stale.length > 0) {
  const preview = stale.map((b) => ({
    bookingId: b.id,
    professionalId: b.professionalId,
    from: b.creationIdempotencyKey,
    to: `import:${b.professionalId}:${b.creationIdempotencyKey.slice('import:'.length)}`,
  }))
  console.log(JSON.stringify(preview, null, 2))

  // Guard against a mid-flight collision with the new code: two bookings must
  // never converge on the same final key.
  const finals = new Set(preview.map((p) => p.to))
  if (finals.size !== preview.length) {
    console.error('ABORT: rename would produce duplicate keys. Nothing written.')
    await prisma.$disconnect()
    process.exit(1)
  }

  if (!APPLY) {
    console.log('DRY RUN — nothing written. Re-run with --yes to apply.')
    await prisma.$disconnect()
    process.exit(0)
  }
} else {
  console.log('Nothing to rename — every import:* bookmark already carries its professionalId.')
  await prisma.$disconnect()
  process.exit(0)
}

let renamed = 0
for (const b of stale) {
  const next = `import:${b.professionalId}:${b.creationIdempotencyKey.slice('import:'.length)}`
  const result = await prisma.booking.updateMany({
    where: {
      id: b.id,
      // Still the exact row we previewed — a concurrent write re-runs the script.
      creationIdempotencyKey: b.creationIdempotencyKey,
    },
    data: { creationIdempotencyKey: next },
  })
  renamed += result.count
}
console.log(`renamed ${renamed} of ${stale.length} bookmark(s)`)

await prisma.$disconnect()
