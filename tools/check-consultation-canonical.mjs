// tools/check-consultation-canonical.mjs
//
// Tripwire for the consultation data model.
//
// `BookingConsultation` is a legacy model that is being deprecated. The
// canonical surface is `ConsultationApproval` + `ConsultationApprovalProof`
// (with the workflow audit trail) and the scalar fields on `Booking`
// (`consultationNotes`, `consultationPrice`, `consultationConfirmedAt`)
// for the negotiated outcome.
//
// This check fails CI when a file accesses the legacy model directly via
// `prisma.bookingConsultation.*` or `tx.bookingConsultation.*`. The schema
// itself still defines the model and the `Booking.consultation` relation
// during the deprecation window — see prisma/schema.prisma — but no new
// code may read or write through that surface.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function normalize(p) {
  return p.split(path.sep).join('/')
}

const ALLOWED_FILES = new Set([])

const TEMP_ALLOWED_FILES = new Set([])

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

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.d.ts',
]

const FORBIDDEN_PATTERNS = [
  'prisma.bookingConsultation',
  'tx.bookingConsultation',
]

function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name)
}

function shouldIgnoreFile(filePath) {
  return IGNORE_FILE_SUFFIXES.some((s) => filePath.endsWith(s))
}

function shouldCheckFile(filePath) {
  return TARGET_EXTENSIONS.has(path.extname(filePath)) && !shouldIgnoreFile(filePath)
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!shouldIgnoreDir(entry.name)) out.push(...walk(full))
      continue
    }
    if (entry.isFile() && shouldCheckFile(full)) out.push(full)
  }
  return out
}

function isAllowedFile(rel) {
  return ALLOWED_FILES.has(rel) || TEMP_ALLOWED_FILES.has(rel)
}

function findViolations(files) {
  const violations = []
  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))
    if (isAllowedFile(rel)) continue

    const content = fs.readFileSync(file, 'utf8')

    for (const pattern of FORBIDDEN_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push({ file: rel, pattern })
      }
    }
  }
  return violations
}

function main() {
  const files = walk(ROOT)
  const violations = findViolations(files)

  if (violations.length > 0) {
    console.error('\nLegacy consultation model violations found:\n')
    for (const v of violations) console.error(`- ${v.file}: ${v.pattern}`)
    console.error(
      '\n`BookingConsultation` is deprecated. Use `ConsultationApproval` and\n' +
        '`ConsultationApprovalProof` for the approval workflow, and the scalar\n' +
        'fields on `Booking` (consultationNotes / consultationPrice /\n' +
        'consultationConfirmedAt) for the negotiated outcome.\n',
    )
    process.exit(1)
  }

  console.log('Consultation canonical model check passed.')
}

main()
