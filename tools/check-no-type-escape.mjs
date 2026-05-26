import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASELINE_PATH = path.join(ROOT, 'tools/baselines/no-type-escape.txt')

const ALLOWED_DIR_PREFIXES = ['lib/typed/']

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

const IGNORE_FILES = new Set([
  normalize('tools/check-no-type-escape.mjs'),
])

const TARGET_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])

const TYPE_ESCAPE_PATTERNS = [
  'as unknown as',
  'as any',
  ': any',
  '<any>',
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

function isAllowedPath(relPath) {
  return ALLOWED_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix))
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

    if (entry.isFile() && hasAllowedExtension(fullPath)) {
      files.push(fullPath)
    }
  }

  return files
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return new Set()
  }

  const content = fs.readFileSync(BASELINE_PATH, 'utf8')

  return new Set(
    content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#')),
  )
}

function makeViolationKey(violation) {
  return `${violation.file}|${violation.pattern}|${violation.snippet}`
}

function findViolations(files) {
  const violations = []

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))

    if (IGNORE_FILES.has(rel) || isAllowedPath(rel)) {
      continue
    }

    const lines = fs.readFileSync(file, 'utf8').split('\n')

    lines.forEach((line, index) => {
      for (const pattern of TYPE_ESCAPE_PATTERNS) {
        const column = line.indexOf(pattern)

        if (column === -1) continue

        violations.push({
          file: rel,
          line: index + 1,
          column: column + 1,
          pattern,
          snippet: line.trim(),
        })
      }
    })
  }

  return violations
}

function writeBaseline(violations) {
  const keys = violations.map(makeViolationKey).sort()
  const content = `${keys.join('\n')}\n`

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
  fs.writeFileSync(BASELINE_PATH, content)

  console.log(`check-no-type-escape: baseline updated with ${keys.length} entries`)
  console.log(`baseline: ${normalize(path.relative(ROOT, BASELINE_PATH))}`)
}

function printViolations(title, violations) {
  console.error(`\n${title}\n`)

  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line}:${violation.column} - ${violation.pattern}`,
    )
    console.error(`  ${violation.snippet}`)
  }
}

function main() {
  const updateBaseline = process.argv.includes('--update-baseline')
  const files = walk(ROOT)
  const violations = findViolations(files)

  if (updateBaseline) {
    writeBaseline(violations)
    return
  }

  const baseline = readBaseline()
  const currentKeys = new Set(violations.map(makeViolationKey))

  const newViolations = violations.filter(
    (violation) => !baseline.has(makeViolationKey(violation)),
  )

  const resolvedBaselineEntries = [...baseline].filter(
    (entry) => !currentKeys.has(entry),
  )

  if (newViolations.length > 0) {
    console.error(
      '\ncheck-no-type-escape: failed\n\nType escape patterns are only allowed inside lib/typed/ with a local, justified helper boundary.',
    )
    printViolations('New type escape violations were found:', newViolations)
    console.error(`\nFound ${newViolations.length} new violations.`)
    console.error(`Known baseline entries: ${baseline.size}`)
    process.exit(1)
  }

  console.log(
    `check-no-type-escape: passed (${baseline.size} known baseline entries)`,
  )

  if (resolvedBaselineEntries.length > 0) {
    console.log('')
    console.log(`${resolvedBaselineEntries.length} baseline entries are now resolved.`)
    console.log('Run with --update-baseline to remove resolved entries.')
  }
}

main()