// tools/check-no-distance-fork.mjs
//
// One spherical distance function. This is the guard for the hole the last one
// could not see.
//
// `check-no-private-lib-fork` matches on NAME: a private declaration that
// collides with something lib/ exports. That caught the copy in
// `app/(main)/search/SearchMapClient.tsx`, because it was also called
// `haversineMiles`. It could not catch the copy in `lib/booking/writeBoundary.ts`,
// because that one was called `distanceMilesBetweenCoordinates` — same constant,
// same trigonometry, different name, invisible. It sat there measuring the
// mobile travel radius (and, after #1024, the miles snapshotted onto a waitlist
// offer) for as long as it existed, and nothing was ever going to report it.
//
// So this guard matches on the PRIMITIVE instead of the name:
//
//   A. an Earth-radius constant, in miles or kilometres, anywhere but the
//      canonical module. Nobody types 3958.7613 for a reason unrelated to
//      measuring the Earth, which makes this prong essentially false-positive
//      free — and it is the prong that would have caught writeBoundary.
//
//   B. `Math.asin` / `Math.acos` / `Math.atan2` with latitude/longitude
//      vocabulary within a few lines. Trig alone is not a smell (a drag angle,
//      a canvas rotation); trig over a coordinate pair is.
//
// NOT covered, deliberately: `METERS_PER_MILE = 1609.344` in `lib/search/pros.ts`
// and the identical `milesToMeters` in `app/(main)/search/_components/MapView.tsx`.
// That IS a second copy of one constant and it is worth collapsing, but it is a
// unit conversion rather than a distance model, and adding it here would mean
// shipping this guard with a baseline — a guard that starts out failing teaches
// people to append to the allowlist. Collapse those two first, then widen this.
//
// Also NOT covered: the PostGIS `ST_Distance(geom, …::geography)` in
// `lib/search/pros.ts`. That is WGS84 spheroid distance — a different model, up
// to ~0.5% from the sphere — and it is the indexed prefilter and sort. It is
// correct where it is and must not be folded into the TS helper.
//
// Usage:
//   node tools/check-no-distance-fork.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CANONICAL = 'lib/geo/distance.ts'
const SCAN_DIRS = ['app', 'lib']
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])
const IGNORE_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.claude',
])

// Earth radius, the values people actually type: miles (mean/authalic), the
// nautical equivalent, kilometres, and the two metre forms (mean and WGS84
// equatorial). Bounded so `63710000` or a version string cannot match.
const EARTH_RADIUS = /(?<![\d.])(3958\.7613|3958\.8|3959|3963\.19|3956|3440\.065|6371\.0088|6371\.0|6371|6367|6378\.137|6371000|6371008|6378137)(?![\d.])/

const TRIG = /Math\.(asin|acos|atan2)\s*\(/
// Word-ish coordinate vocabulary. `\blat\b` alone would miss `dLat`/`fromLat`,
// so match the suffix form too — but never inside `related`, `translate`, etc.
const COORD = /\b(?:lat|lng|lon|latitude|longitude)\b|\b[a-z]+(?:Lat|Lng|Lon|Latitude|Longitude)\b/i
const COORD_WINDOW = 8

function normalize(p) {
  return p.split(path.sep).join('/')
}

function isTestFile(rel) {
  return (
    rel.includes('.test.') ||
    rel.includes('.spec.') ||
    rel.includes('/__tests__/')
  )
}

function walk(dir) {
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter((file) => TARGET_EXTENSIONS.has(path.extname(file)))
    .filter(
      (file) =>
        !normalize(path.relative(ROOT, file))
          .split('/')
          .some((segment) => IGNORE_DIRS.has(segment)),
    )
}

/**
 * SPECIMENS — the three forks this consolidation removed, plus the shape a
 * future one is most likely to take (kilometres, `acos`, no shared name), plus
 * a negative: trigonometry that is legitimately not about the Earth.
 *
 * The tripwire below runs the matchers over these rather than over the canonical
 * module. That distinction is load-bearing: the first version of this guard
 * asserted "the radius regex matches something in lib/geo/distance.ts", and it
 * stayed green after `3958.7613` was deleted from the alternation — because the
 * file's own DOC COMMENT says "6371.0088 km". A tripwire a comment can satisfy
 * is not a tripwire. These specimens are code, and each names the fork it stands
 * for, so a regex edit that stops catching one fails here immediately.
 */
const SPECIMENS = {
  // was: lib/discovery/nearby.ts (exported, asin)
  discovery: `const earthRadiusMiles = 3958.7613
  const dLat = toRad(b.lat - a.lat)
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))`,
  // was: lib/booking/writeBoundary.ts (private, atan2, DIFFERENT NAME)
  booking: `const earthRadiusMiles = 3958.7613
  const deltaLatRad = degreesToRadians(args.toLat - args.fromLat)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))`,
  // was: app/(main)/search/SearchMapClient.tsx (private, asin)
  searchMap: `const radiusMiles = 3958.7613
  const lat1 = toRad(a.lat)
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)))`,
  // the next one: metric, law-of-cosines, shares no identifier with any of the above
  metricAcos: `const R = 6371
  const d = R * Math.acos(Math.sin(latitude) * Math.sin(lat2))`,
}

/** Trig that is not about the Earth. Must NOT be flagged. */
const NEGATIVE_SPECIMEN = `export function angleOf(dx: number, dy: number) {
  return (Math.atan2(dy, dx) * 180) / Math.PI
}`

/**
 * The guard's own tripwire. Without it, a broken regex leaves every prong quiet
 * and this file passes while enforcing nothing — which is precisely the failure
 * mode that let the writeBoundary fork live undetected.
 */
function assertMatchersWork() {
  for (const [name, specimen] of Object.entries(SPECIMENS)) {
    const radiusLine = specimen
      .split('\n')
      .find((line) => EARTH_RADIUS.test(line))

    if (!radiusLine) {
      throw new Error(
        `check-no-distance-fork: the Earth-radius matcher no longer catches the ` +
          `\`${name}\` fork specimen. That fork was real. Fix the regex rather ` +
          'than leaving the check passing vacuously.',
      )
    }

    if (!TRIG.test(specimen) || !COORD.test(specimen)) {
      throw new Error(
        `check-no-distance-fork: prong B no longer catches the \`${name}\` fork ` +
          'specimen (trigonometry over a coordinate pair). Fix the regex.',
      )
    }
  }

  if (TRIG.test(NEGATIVE_SPECIMEN) && COORD.test(NEGATIVE_SPECIMEN)) {
    throw new Error(
      'check-no-distance-fork: prong B now flags plain rotation math as a ' +
        'distance fork. Narrow the coordinate vocabulary — a guard that cries ' +
        'wolf gets an allowlist entry, and then it is over.',
    )
  }

  const canonicalPath = path.join(ROOT, CANONICAL)

  if (!fs.existsSync(canonicalPath)) {
    throw new Error(
      `check-no-distance-fork: ${CANONICAL} does not exist. This guard exists to ` +
        'keep every distance measurement pointed at it — if it moved, update ' +
        'CANONICAL here rather than leaving the guard enforcing nothing.',
    )
  }

  // The canonical module must still DECLARE a radius, not merely mention one in
  // prose — otherwise the thing everything imports has quietly stopped being a
  // distance function.
  const declaresRadius = fs
    .readFileSync(canonicalPath, 'utf8')
    .split('\n')
    .some((line) => /^\s*(?:const|let)\s/.test(line) && EARTH_RADIUS.test(line))

  if (!declaresRadius) {
    throw new Error(
      `check-no-distance-fork: ${CANONICAL} no longer declares an Earth-radius ` +
        'constant. Either it stopped being the canonical distance module, or the ' +
        'regex broke. Resolve which before shipping.',
    )
  }
}

function findViolations() {
  const violations = []

  for (const scanDir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, scanDir))) {
      const rel = normalize(path.relative(ROOT, file))
      if (rel === CANONICAL) continue
      if (isTestFile(rel)) continue

      const lines = fs.readFileSync(file, 'utf8').split('\n')

      lines.forEach((line, index) => {
        if (EARTH_RADIUS.test(line)) {
          violations.push({
            file: rel,
            line: index + 1,
            snippet: line.trim(),
            why: 'declares an Earth-radius constant',
          })
          return
        }

        if (!TRIG.test(line)) return

        // Look around the trig call for coordinate vocabulary — a haversine
        // spans several lines, and the `Math.asin` line itself usually names
        // none of them.
        const from = Math.max(0, index - COORD_WINDOW)
        const to = Math.min(lines.length, index + COORD_WINDOW + 1)
        if (!COORD.test(lines.slice(from, to).join('\n'))) return

        violations.push({
          file: rel,
          line: index + 1,
          snippet: line.trim(),
          why: 'applies trigonometry to a latitude/longitude pair',
        })
      })
    }
  }

  return violations
}

function main() {
  try {
    assertMatchersWork()
  } catch (error) {
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }

  const violations = findViolations()

  if (violations.length > 0) {
    console.error('\ncheck-no-distance-fork: failed\n')
    console.error(
      `Spherical distance has one home: ${CANONICAL}. Import \`haversineMiles\`\n` +
        'from it instead of re-deriving the measurement here.\n\n' +
        'If you genuinely need a DIFFERENT model — the PostGIS spheroid distance,\n' +
        'a projected/planar approximation — it does not belong in a hand-rolled\n' +
        'haversine either. Say which model you need and why, in the code.\n',
    )

    for (const v of violations) {
      console.error(`${v.file}:${v.line}`)
      console.error(`  ${v.snippet}`)
      console.error(`  → ${v.why}`)
    }

    console.error(`\nFound ${violations.length} distance fork(s).`)
    process.exit(1)
  }

  console.log(
    `check-no-distance-fork: passed (canonical ${CANONICAL}, no forks in ${SCAN_DIRS.join('/')})`,
  )
}

main()
