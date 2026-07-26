// tools/check-booking-status-labels.mjs
//
// A booking status gets ONE word, from one table.
//
// B10 found six hand-written BookingStatus→label maps. They disagreed
// (`Accepted` vs `Confirmed`, `No show` vs `No-show`), and — worse — the two
// newest states were missing from most of them, so a client's own booking page
// and the pro's own calendar printed the raw enum or mislabelled a live session
// and a no-show as "Accepted". Prod had two IN_PROGRESS bookings the day this
// was written.
//
// The rule: a file that maps TWO OR MORE BookingStatus values to display
// strings is a label table, and there is only one legal home for one. Anything
// else must call `labelForBookingStatus` (or the brand copy that mirrors it).
//
// Deliberately shaped around the failure, not around style:
//   - it counts DISTINCT statuses, so a single deliberate exception (the
//     confirmation page's longer "Requested (waiting for confirmation)") does
//     not trip it;
//   - a status mapped to itself is not a label (`'PENDING': 'PENDING'` is a
//     normalizer, not a display word), and a Set of statuses is not a map;
//   - it cannot prove the WORDS agree — `lib/booking/statusLabel.test.ts` asks
//     every surviving producer the same question and requires one answer.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

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
  'docs',
  'prisma',
])

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])

const IGNORE_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx']

const BOOKING_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]

// The one legal home for the table, plus the white-label copy layer that
// mirrors it (`defaultProCalendarCopy.statusLabels`) — the calendar renders
// brand-overridable words, and `statusLabel.test.ts` pins them equal.
const ALLOWED = new Set([
  'lib/booking/statusLabel.ts',
  'lib/brand/defaultProCalendarCopy.ts',
])

// `case 'ACCEPTED': return 'Confirmed'` / `if (s === 'ACCEPTED') return '…'`
const SWITCH_OR_IF = new RegExp(
  `['"\`](${BOOKING_STATUSES.join('|')})['"\`]\\s*(?::|\\))\\s*(?:return\\s+)?['"\`]([^'"\`]*)['"\`]`,
  'g',
)

// `ACCEPTED: 'Confirmed'` / `'ACCEPTED': 'Confirmed'` object properties
const OBJECT_PROPERTY = new RegExp(
  `(?:^|[\\s,{])['"\`]?(${BOOKING_STATUSES.join('|')})['"\`]?\\s*:\\s*['"\`]([^'"\`]*)['"\`]`,
  'gm',
)

// The same tables written against the Prisma enum rather than string literals:
// `case BookingStatus.ACCEPTED: return 'Confirmed'`,
// `if (s === BookingStatus.ACCEPTED) return 'Confirmed'`,
// `[BookingStatus.ACCEPTED]: 'Confirmed'`.
//
// Added after the first version of this guard ran green on the pre-fix tree for
// `lifecycleActionViewModel.ts` — the one file whose disagreeing table started
// this card. A guard that misses the original defect is not a guard.
const ENUM_MEMBER = new RegExp(
  `BookingStatus\\.(${BOOKING_STATUSES.join('|')})\\s*(?:\\]?\\s*:|\\))\\s*(?:return\\s+)?['"\`]([^'"\`]*)['"\`]`,
  'g',
)

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

function shouldCheckFile(filePath) {
  if (!TARGET_EXTENSIONS.has(path.extname(filePath))) return false
  return !IGNORE_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix))
}

function walk(dir) {
  const files = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) files.push(...walk(fullPath))
      continue
    }

    if (entry.isFile() && shouldCheckFile(fullPath)) files.push(fullPath)
  }

  return files
}

function labelPairsIn(content) {
  const pairs = new Map()

  for (const pattern of [SWITCH_OR_IF, OBJECT_PROPERTY, ENUM_MEMBER]) {
    pattern.lastIndex = 0
    for (const match of content.matchAll(pattern)) {
      const [, status, label] = match
      // A status mapped to itself (or to another status) is normalization, not
      // a display word.
      if (BOOKING_STATUSES.includes(label)) continue
      if (!label.trim()) continue
      pairs.set(status, label)
    }
  }

  return pairs
}

function findViolations(files) {
  const violations = []

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))
    if (ALLOWED.has(rel)) continue

    const pairs = labelPairsIn(fs.readFileSync(file, 'utf8'))
    if (pairs.size < 2) continue

    violations.push({
      file: rel,
      pairs: [...pairs].map(([status, label]) => `${status} → "${label}"`),
    })
  }

  return violations
}

function main() {
  const violations = findViolations(walk(ROOT))

  if (violations.length > 0) {
    console.error('\nHand-written BookingStatus label tables:\n')
    for (const violation of violations) {
      console.error(`- ${violation.file}`)
      for (const pair of violation.pairs) console.error(`    ${pair}`)
    }
    console.error(
      '\nA booking status gets ONE word, from lib/booking/statusLabel.ts —\n' +
        'call labelForBookingStatus(status) instead. Six of these had drifted\n' +
        'apart (B10): the same booking read "Accepted" on one screen and\n' +
        '"Confirmed" on the next, and the maps missing an IN_PROGRESS or\n' +
        'NO_SHOW arm printed the raw enum at a client.\n',
    )
    process.exit(1)
  }

  console.log('Booking status label check passed.')
}

main()
