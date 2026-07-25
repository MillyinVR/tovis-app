// tools/check-rate-limit-buckets-wired.mjs
//
// Every rate-limit bucket registered in `lib/rateLimit/policies.ts` must be
// ENFORCED somewhere. A bucket is a policy decision — a limit, a window and a
// fail-open/fail-closed mode, usually with a comment explaining the ceiling.
// Registering one and never calling it produces the worst possible outcome:
// the repo reads as if the surface is protected, and it is not.
//
// B4-A (2026-07-25) found exactly that. `looks:like` (60/60s) and
// `looks:comment` (12/60s) had been registered since the canonical-limiter
// refactor (29618d61) and had ZERO call sites — `git log -S rateLimit --
// app/api/v1/looks/` returns nothing, so those routes were never rate limited
// at any point in their history. Meanwhile the like route fires
// `notifyLookLiked` + `notifyLookMilestones` + `kickNotificationDrain()` on
// every POST, so an unlike/relike loop re-notified the look's owner without
// bound.
//
// This guard cannot tell you that a surface NEEDS a bucket — that judgement is
// the B4-A sweep's, recorded in the audit plan. What it does pin is the much
// narrower claim that the repo's own stated policy is actually wired up: if you
// take the trouble to size a ceiling, something has to enforce it.
//
// A bucket referenced only from a test does NOT count as wired: a test that
// names a bucket proves the string exists, not that a request passes through it.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

const POLICIES_FILE = normalize('lib/rateLimit/policies.ts')

// The limiter's own module owns the declarations (and the generic
// enforce/response plumbing), so references from inside it are never evidence
// that a bucket is enforced on a real surface.
const DECLARATION_DIR = 'lib/rateLimit/'

const SEARCH_DIRS = ['app', 'lib', 'scripts']

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
  '.test.mjs',
]

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

function isTargetFile(filePath) {
  if (!TARGET_EXTENSIONS.has(path.extname(filePath))) return false
  return !IGNORE_FILE_SUFFIXES.some((suffix) => filePath.endsWith(suffix))
}

function walk(dir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue
      walk(full, out)
    } else if (entry.isFile() && isTargetFile(full)) {
      out.push(full)
    }
  }

  return out
}

/**
 * The declared buckets are the KEYS of the `RATE_LIMITS` record — the runtime
 * source of truth. (The `RateLimitBucket` union above it is type-only; reading
 * the record means a bucket that exists at runtime cannot hide from the guard.)
 */
function readDeclaredBuckets(source) {
  const start = source.indexOf('export const RATE_LIMITS')
  if (start === -1) {
    throw new Error(
      'check-rate-limit-buckets-wired: could not find `export const RATE_LIMITS` ' +
        `in ${POLICIES_FILE}. The guard reads that record to enumerate buckets; ` +
        'if it was renamed, update this guard rather than deleting it.',
    )
  }

  const body = source.slice(start)
  // Keys are top-level quoted strings followed by `: {` — the config objects
  // themselves contain no quoted keys, so this cannot pick up a nested field.
  const keys = [...body.matchAll(/^\s{2}'([^']+)'\s*:\s*\{/gm)].map((m) => m[1])

  if (keys.length === 0) {
    throw new Error(
      'check-rate-limit-buckets-wired: parsed ZERO buckets out of ' +
        `${POLICIES_FILE}. That is a guard failure, not a clean tree — ` +
        'the record shape changed. Fix the parser.',
    )
  }

  return keys
}

function main() {
  const policiesPath = path.join(ROOT, POLICIES_FILE)
  let policiesSource
  try {
    policiesSource = fs.readFileSync(policiesPath, 'utf8')
  } catch {
    console.error(
      `check-rate-limit-buckets-wired: cannot read ${POLICIES_FILE}. ` +
        'The limiter policy file is required.',
    )
    process.exit(1)
  }

  const declared = readDeclaredBuckets(policiesSource)

  const files = []
  for (const dir of SEARCH_DIRS) {
    walk(path.join(ROOT, dir), files)
  }

  /** @type {Map<string, string[]>} bucket -> call-site files */
  const wired = new Map(declared.map((bucket) => [bucket, []]))

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))
    if (rel.startsWith(DECLARATION_DIR)) continue

    let source
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const bucket of declared) {
      // The bucket is always passed as a string literal (`bucket: 'holds:create'`).
      if (source.includes(`'${bucket}'`) || source.includes(`"${bucket}"`)) {
        wired.get(bucket).push(rel)
      }
    }
  }

  const unwired = declared.filter((bucket) => wired.get(bucket).length === 0)

  if (unwired.length > 0) {
    console.error(
      '\ncheck-rate-limit-buckets-wired: registered bucket(s) with NO enforcement site:\n',
    )
    for (const bucket of unwired) {
      console.error(`  - '${bucket}'`)
    }
    console.error(
      '\nA registered bucket that nothing calls makes the surface LOOK protected\n' +
        'while it is wide open. Either wire it up:\n' +
        "  const limited = await enforceRateLimit({ bucket: '<name>', identity })\n" +
        'or delete it from RATE_LIMITS. Do not leave it declared and unused.\n',
    )
    process.exit(1)
  }

  console.log(
    `check-rate-limit-buckets-wired: passed (${declared.length} buckets, all enforced)`,
  )
}

main()
