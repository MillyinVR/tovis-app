// tools/check-media-visibility-boundary.mjs
//
// Tripwire for the MediaAsset bucket/visibility invariant on the WRITE side.
//
// The invariant (lib/media/recordMediaAsset.ts): `visibility = PRO_CLIENT` media
// must live in `media-private`, because `media-public` is world-readable by URL.
//
// It was asserted on CREATE only. Every UPDATE path hand-rolled its own
// `featured || looksEligible ? PUBLIC : PRO_CLIENT` and wrote the result with no
// bucket in the calculation, so retracting a photo the pro had uploaded to
// `media-public` stamped it PRO_CLIENT over world-readable bytes. That shipped:
// 3 production rows, an unauthenticated GET returning HTTP 200 and the full
// file (found 2026-09-01).
//
// This check fails CI when a file:
//   1. contains a MediaAsset write primitive (`mediaAsset.update` /
//      `.updateMany` / `.upsert` / `.create` / `.createMany`), AND
//   2. writes a `visibility:` field in a data payload (as opposed to only
//      reading it in a `where` / `select`), AND
//   3. does NOT import one of the two boundary modules that own the rule:
//        @/lib/media/mediaVisibility   (resolveMediaVisibility — updates)
//        @/lib/media/recordMediaAsset  (buildMediaAssetCreateData — creates)
//
// The fix is always to route the value through the boundary rather than
// recomputing it locally. A local `computeVisibility()` that ignores the bucket
// is exactly the fork this exists to catch — it is not enough to import the
// module and then write your own value, but importing it is the signal a human
// reviewed the bucket question at all.
//
// Self-test: `node tools/check-media-visibility-boundary.mjs --self-test`
// proves the matcher fires on the pre-fix source and stays quiet on the fixed
// source, so a future edit that neuters the pattern is visible.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()

function normalize(p) {
  return p.split(path.sep).join('/')
}

const ALLOWED_FILES = new Set([
  // The boundary itself.
  normalize('lib/media/mediaVisibility.ts'),
  normalize('lib/media/recordMediaAsset.ts'),
  // §19b publication mirror. Writes `visibility: PUBLIC` only, on the publish
  // branch — PUBLIC is legal in either bucket, so it cannot break the
  // invariant, and the consent question upstream is owned by
  // createOrUpdateProLookFromMediaAsset / isUnpromotedPrivateMedia. The
  // unpublish branch deliberately writes no visibility at all.
  normalize('lib/looks/publication/service.ts'),
  // Client review attach. Writes `visibility: PUBLIC` (REVIEW_MEDIA_VISIBILITY)
  // onto media the CLIENT just promoted, and builds its new rows through
  // buildMediaAssetCreateData.
  normalize('app/api/v1/client/bookings/[id]/review/route.ts'),
])

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tools',
  'tests',
  'prisma',
])

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])

const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.d.ts',
]

const WRITE_PATTERNS = [
  'mediaAsset.update',
  'mediaAsset.updateMany',
  'mediaAsset.upsert',
  'mediaAsset.create',
  'mediaAsset.createMany',
]

// `visibility:` followed by something that is not `true` / `false` — a select or
// a boolean projection is a read, an enum/expression is a write. This
// deliberately over-matches `where: { visibility: X }`; a file that filters on
// visibility AND writes MediaAssets is exactly a file worth a human look, and
// the allowlist above records the ones reviewed.
//
// 🔴 `storageBucket:` is deliberately NOT matched here, and that is a limit
// worth stating rather than papering over. Writing the bucket breaks the same
// invariant (resolving a legacy row's pointers can move it into the
// world-readable bucket), but the write is textually IDENTICAL to a read being
// forwarded — `storageBucket: ptrs.storageBucket` writes, while
// `storageBucket: media.storageBucket` in portfolioLookSync.ts only reads. An
// earlier revision of this guard matched both and had to either allowlist a
// legitimate reader (masking any real write added there later) or exclude the
// `x.field` shape, which then missed the write. Neither is honest.
//
// The one update in the codebase that rewrites a bucket
// (`backfillPointersIfMissing`) is covered BEHAVIOURALLY instead, by
// tests/integration/media-visibility-bucket-invariant.test.ts — a real
// assertion about the row it produces, which is stronger evidence than a regex.
const VISIBILITY_WRITE_PATTERN = /\bvisibility\s*:\s*(?!true\b|false\b)\S/

const BOUNDARY_IMPORT_PATTERN =
  /from\s+['"]@\/lib\/media\/(mediaVisibility|recordMediaAsset)['"]/

function shouldIgnoreFile(filePath) {
  return IGNORE_FILE_SUFFIXES.some((s) => filePath.endsWith(s))
}

function shouldCheckFile(filePath) {
  return (
    TARGET_EXTENSIONS.has(path.extname(filePath)) && !shouldIgnoreFile(filePath)
  )
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) out.push(...walk(full))
      continue
    }
    if (entry.isFile() && shouldCheckFile(full)) out.push(full)
  }
  return out
}

/** The rule, isolated so the self-test can drive it directly. */
export function violates(content) {
  if (!WRITE_PATTERNS.some((p) => content.includes(p))) return false
  if (!VISIBILITY_WRITE_PATTERN.test(content)) return false
  if (BOUNDARY_IMPORT_PATTERN.test(content)) return false
  return true
}

function findViolations(files) {
  const violations = []
  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))
    if (ALLOWED_FILES.has(rel)) continue
    if (violates(fs.readFileSync(file, 'utf8'))) violations.push(rel)
  }
  return violations
}

// The shape that shipped the bug: a local flags-only visibility function and a
// bucket-blind update.
const PRE_FIX_SAMPLE = `
function computeVisibility(featured, looks) {
  return featured || looks ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}
await prisma.mediaAsset.update({
  where: { id },
  data: { isFeaturedInPortfolio: false, visibility: computeVisibility(false, false) },
})
`

const FIXED_SAMPLE = `
import { resolveMediaVisibility } from '@/lib/media/mediaVisibility'
await prisma.mediaAsset.update({
  where: { id },
  data: {
    isFeaturedInPortfolio: false,
    visibility: resolveMediaVisibility({
      storageBucket: media.storageBucket,
      isFeaturedInPortfolio: false,
      isEligibleForLooks: false,
    }),
  },
})
`

// A MediaAsset writer that only touches the flags, alongside a forwarded
// storageBucket READ — the shape of lib/looks/publication/portfolioLookSync.ts.
// Must stay quiet, or a legitimate reader lands in the allowlist.
const READ_FORWARD_SAMPLE = `
await tx.mediaAsset.update({ where: { id }, data: { isEligibleForLooks: true } })
const consentOk = !isUnpromotedPrivateMedia({
  bookingId: media.bookingId,
  storageBucket: media.storageBucket,
  reviewId: media.reviewId,
})
`

function selfTest() {
  const failures = []
  if (!violates(PRE_FIX_SAMPLE)) {
    failures.push('matcher did NOT fire on the pre-fix sample (it fails open)')
  }
  if (violates(FIXED_SAMPLE)) {
    failures.push('matcher fired on the fixed sample (it fails closed)')
  }
  if (violates(READ_FORWARD_SAMPLE)) {
    failures.push('matcher fired on a read-and-forward (false positive)')
  }

  if (failures.length > 0) {
    console.error('\nMedia visibility boundary SELF-TEST failed:\n')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }

  console.log('Media visibility boundary self-test passed (red on the bug, green on the fix).')
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest()
    return
  }

  const violations = findViolations(walk(ROOT))

  if (violations.length > 0) {
    console.error('\nMedia visibility boundary violations found:\n')
    for (const v of violations) console.error(`- ${v}`)
    console.error(
      '\nFiles that write a MediaAsset `visibility` must import the boundary that\n' +
        'owns the bucket/visibility invariant:\n' +
        '  updates → `resolveMediaVisibility` from @/lib/media/mediaVisibility\n' +
        '  creates → `buildMediaAssetCreateData` from @/lib/media/recordMediaAsset\n\n' +
        'PRO_CLIENT media must live in media-private; media-public is world-readable,\n' +
        'so a locally computed `featured || looks ? PUBLIC : PRO_CLIENT` stamps\n' +
        '"private" onto bytes anyone can fetch. That is a real production defect,\n' +
        'not a theoretical one — see lib/media/mediaVisibility.ts.\n',
    )
    process.exit(1)
  }

  console.log('Media visibility boundary check passed.')
}

// Importable (the boundary test drives `violates` against the real pre-fix
// source from git); only sweeps when run as a script.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
