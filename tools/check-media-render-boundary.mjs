// tools/check-media-render-boundary.mjs
//
// Tripwire for the secure media rendering boundary.
//
// Booking media is persisted with `url: null` / `thumbUrl: null` and only
// storage pointers (`storageBucket`, `storagePath`, `thumbBucket`, `thumbPath`).
// Any consumer that selects `url` or `thumbUrl` from `mediaAsset` and renders
// them directly to a user will display broken images.
//
// This check fails CI when a file:
//   1. Reads from `mediaAsset.findMany` / `findUnique` / `findFirst`
//   2. Selects `url: true` or `thumbUrl: true`
//   3. Does NOT import `renderMediaUrls` from `@/lib/media/renderUrls`
//
// The fix is always: select the storage pointers too, then map rows through
// `renderMediaUrls()` from `lib/media/renderUrls.ts`.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

function normalize(p) {
  return p.split(path.sep).join('/')
}

const ALLOWED_FILES = new Set([
  normalize('lib/media/renderUrls.ts'),
  // Maintenance script that intentionally manipulates raw URL fields to
  // backfill / repair stored data; never returns these to a client.
  normalize('scripts/fix-media-urls.ts'),
])

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

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])

const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.d.ts',
]

const READ_PATTERNS = [
  'mediaAsset.findMany',
  'mediaAsset.findUnique',
  'mediaAsset.findFirst',
]

const URL_FIELD_PATTERNS = [/\burl\s*:\s*true\b/, /\bthumbUrl\s*:\s*true\b/]

const RENDER_IMPORT_PATTERN = /from\s+['"]@\/lib\/media\/renderUrls['"]/

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

function fileHasMediaRead(content) {
  return READ_PATTERNS.some((p) => content.includes(p))
}

function fileSelectsUrlField(content) {
  return URL_FIELD_PATTERNS.some((re) => re.test(content))
}

function fileImportsRenderer(content) {
  return RENDER_IMPORT_PATTERN.test(content)
}

function findViolations(files) {
  const violations = []
  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))
    if (isAllowedFile(rel)) continue

    const content = fs.readFileSync(file, 'utf8')
    if (!fileHasMediaRead(content)) continue
    if (!fileSelectsUrlField(content)) continue
    if (fileImportsRenderer(content)) continue

    violations.push(rel)
  }
  return violations
}

function main() {
  const files = walk(ROOT)
  const violations = findViolations(files)

  if (violations.length > 0) {
    console.error('\nMedia render boundary violations found:\n')
    for (const v of violations) console.error(`- ${v}`)
    console.error(
      '\nFiles that select `url` or `thumbUrl` from `mediaAsset` must also import\n' +
        '`renderMediaUrls` from `@/lib/media/renderUrls` and pass each row through it.\n' +
        'Booking media is stored with null URL fields and storage pointers only —\n' +
        'reading `.url` / `.thumbUrl` directly will render broken images.\n',
    )
    process.exit(1)
  }

  console.log('Media render boundary check passed.')
}

main()
