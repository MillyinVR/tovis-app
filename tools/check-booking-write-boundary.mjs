import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const ALLOWED_FILES = new Set([
  normalize('lib/booking/writeBoundary.ts'),
])

const TEMP_ALLOWED_FILES = new Set([
  normalize('app/api/pro/bookings/[id]/aftercare/route.ts'),
  normalize('app/api/pro/bookings/[id]/finish/route.ts'),
  normalize('app/api/pro/bookings/[id]/media/route.ts'),
  normalize('app/api/pro/bookings/[id]/start/route.ts'),
  normalize('app/api/pro/last-minute/route.ts'),
  normalize('lib/booking/transitions.ts'),
  normalize('lib/reminders.ts'),
])

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'tools',
  'tests',
])

const TARGET_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])

const IGNORE_FILE_BASENAMES = new Set([
  'wipe_test_data.cjs',
])

const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
]

const FORBIDDEN_PATTERNS = [
  'prisma.booking.create(',
  'prisma.booking.update(',
  'prisma.booking.delete(',
  'prisma.booking.createMany(',
  'prisma.booking.updateMany(',
  'prisma.booking.deleteMany(',

  'tx.booking.create(',
  'tx.booking.update(',
  'tx.booking.delete(',
  'tx.booking.createMany(',
  'tx.booking.updateMany(',
  'tx.booking.deleteMany(',

  'prisma.bookingHold.create(',
  'prisma.bookingHold.update(',
  'prisma.bookingHold.delete(',
  'prisma.bookingHold.createMany(',
  'prisma.bookingHold.updateMany(',
  'prisma.bookingHold.deleteMany(',

  'tx.bookingHold.create(',
  'tx.bookingHold.update(',
  'tx.bookingHold.delete(',
  'tx.bookingHold.createMany(',
  'tx.bookingHold.updateMany(',
  'tx.bookingHold.deleteMany(',
]

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name)
}

function hasAllowedExtension(filePath) {
  return TARGET_EXTENSIONS.has(path.extname(filePath))
}

function shouldIgnoreFile(filePath) {
  const baseName = path.basename(filePath)

  if (IGNORE_FILE_BASENAMES.has(baseName)) {
    return true
  }

  return IGNORE_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix))
}

function shouldCheckFile(filePath) {
  return hasAllowedExtension(filePath) && !shouldIgnoreFile(filePath)
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name)) {
        files.push(...walk(fullPath))
      }
      continue
    }

    if (entry.isFile() && shouldCheckFile(fullPath)) {
      files.push(fullPath)
    }
  }

  return files
}

function isAllowedFile(relPath) {
  return ALLOWED_FILES.has(relPath) || TEMP_ALLOWED_FILES.has(relPath)
}

function findViolations(files) {
  const violations = []

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))

    if (isAllowedFile(rel)) {
      continue
    }

    const content = fs.readFileSync(file, 'utf8')

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push({ file: rel, pattern })
      }
    }
  }

  return violations
}

function printAllowedMigrationStatus() {
  if (TEMP_ALLOWED_FILES.size === 0) {
    return
  }

  console.log('\nTemporarily allowlisted during migration:\n')
  for (const file of [...TEMP_ALLOWED_FILES].sort()) {
    console.log(`- ${file}`)
  }
  console.log('')
}

function main() {
  const files = walk(ROOT)
  const violations = findViolations(files)

  if (violations.length > 0) {
    console.error('\nBooking write boundary violations found:\n')
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.pattern}`)
    }
    console.error(
      '\nAll Booking / BookingHold writes must go through lib/booking/writeBoundary.ts\n',
    )
    printAllowedMigrationStatus()
    process.exit(1)
  }

  console.log('Booking write boundary check passed.')
  printAllowedMigrationStatus()
}

main()