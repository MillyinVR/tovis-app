#!/usr/bin/env node
// tools/check-ios-parity-fixtures.mjs
//
// The cross-repo half of the PARITY fixtures: fails a tovis-app change whose
// generated parity fixture no longer matches the copy tovis-ios drives its
// Swift twins over.
//
// What this is for, concretely. `lib/looks/tags.ts` has a Swift twin in
// tovis-ios (`LooksPath.slugifyTag` / `LooksPath.tagSlug`). Web owns the rule;
// the phone reimplements it so a tapped `/looks/tags/{slug}` link resolves to
// the same feed. Before this, the iOS side asserted HAND-WRITTEN expected
// values, so nothing tied the twin to the original: web could start keeping
// hyphens, or transliterate an accent, and tag links built on web would open a
// different feed (or nothing) on the phone, with both test suites green.
//
// `schema/parity/lookTagSlugs.json` is generated from the real functions
// (`lib/looks/tagSlugParity.test.ts` fails if it drifts from them, in this
// repo). This guard closes the other half: it proves tovis-ios is driving its
// twin over THE SAME pairs, not a stale snapshot of them.
//
// ── Merge order ────────────────────────────────────────────────────────────
// iOS FIRST, which is this repo's existing convention for fixtures (see
// check-ios-fixture-contract.mjs). The iOS side reads nothing from here — its
// Swift test drives its own committed copy — so an iOS PR carrying the new
// fixture (and whatever twin change it forces) is green on its own and can land
// first. This guard then goes green here.
//
// That ordering is deliberate rather than incidental: the comparison is byte
// equality, so if BOTH sides enforced it across the wall neither PR could ever
// be green first. Only this side enforces it.
//
// ── Why bytes, not parsed equality ─────────────────────────────────────────
// Some cases in the slug fixture are DECOMPOSED (a base letter plus a combining
// mark) and exist precisely to distinguish that from the precomposed spelling.
// The generator escapes every non-ASCII code point so nothing can normalize
// them; comparing parsed objects would not notice a copy that had been
// normalized on the way into the other repo, which is the failure the escaping
// exists to prevent.
//
// Knobs:
//   TOVIS_IOS_DIR   where tovis-ios is checked out. Default: ../tovis-ios, then
//                   ~/Dev/tovis-ios.
//   TOVIS_IOS_REF   which iOS revision to compare against. Default
//                   `origin/main` — that is the ref a merge from here would
//                   strand. `worktree` compares the checkout in place.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const NAME = 'check-ios-parity-fixtures'
const DEFAULT_REF = 'origin/main'
const WORKTREE = 'worktree'

/**
 * Every parity fixture this repo publishes, and where tovis-ios keeps its copy.
 *
 * Add a row when a new rule grows a Swift twin. `web` is generated — name the
 * command that writes it so a failure can say how to fix itself.
 */
const PARITY_FIXTURES = [
  {
    what: 'look-tag slug rule (lib/looks/tags.ts -> LooksPath.slugifyTag)',
    web: 'schema/parity/lookTagSlugs.json',
    ios: 'TovisTests/Fixtures/lookTagSlugs.json',
    regen: 'pnpm gen:look-tag-slug-fixture',
  },
]

/**
 * Exit 0, loudly. Best effort by design: not everyone has both repos checked
 * out. A silent skip would be the "manufactures confidence" failure, so every
 * skip says what it did not check and how to enable it.
 */
function skip(reason, remedy) {
  console.log(`${NAME}: SKIPPED — NOT ENFORCED.`)
  console.log(`  ${reason}`)
  if (remedy) console.log(`  ${remedy}`)
  console.log(
    '  A parity-rule change here can still leave tovis-ios driving stale pairs.',
  )
  process.exit(0)
}

function fail(lines) {
  for (const line of lines) console.error(line)
  process.exit(1)
}

/**
 * `process.env` with git's repo-redirecting variables stripped.
 *
 * 🔴 Load-bearing under a HOOK, exactly as in check-ios-fixture-contract.mjs:
 * git exports `GIT_DIR` to the hooks it runs and `GIT_DIR` OVERRIDES
 * `git -C <dir>`, so without this every read below silently returns a file from
 * THIS repo instead of the iOS checkout.
 */
function gitEnvForOtherRepo() {
  const env = { ...process.env }
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_PREFIX',
  ]) {
    delete env[key]
  }
  return env
}

/**
 * First candidate that actually looks like the iOS repo.
 *
 * An explicit TOVIS_IOS_DIR is authoritative: if it is set and wrong, skip
 * naming THAT path rather than quietly checking some other checkout.
 */
function locateIosRepo() {
  const looksRight = (dir) => existsSync(join(dir, 'TovisTests'))

  if (process.env.TOVIS_IOS_DIR) {
    const dir = resolve(process.env.TOVIS_IOS_DIR)
    return looksRight(dir) ? dir : null
  }
  for (const dir of [
    resolve(process.cwd(), '..', 'tovis-ios'),
    join(homedir(), 'Dev', 'tovis-ios'),
  ]) {
    if (looksRight(dir)) return dir
  }
  return null
}

function shortSha(iosDir, ref) {
  try {
    return execFileSync('git', ['-C', iosDir, 'rev-parse', '--short', ref], {
      encoding: 'utf8',
      env: gitEnvForOtherRepo(),
    }).trim()
  } catch {
    return ref
  }
}

/** The file's content at `ref`, or null when it does not exist there. */
function readAtRef(iosDir, ref, path) {
  if (ref === WORKTREE) {
    const full = join(iosDir, path)
    return existsSync(full) ? readFileSync(full, 'utf8') : null
  }
  try {
    return execFileSync('git', ['-C', iosDir, 'show', `${ref}:${path}`], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      // stderr ignored: a missing path is an expected answer here (the iOS
      // side has not landed yet), not something to spray on the console.
      stdio: ['ignore', 'pipe', 'ignore'],
      env: gitEnvForOtherRepo(),
    })
  } catch {
    return null
  }
}

/** First differing line, for a message that points at something. */
function describeDiff(webText, iosText) {
  const a = webText.split('\n')
  const b = iosText.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) {
      return [
        `    first difference at line ${i + 1}:`,
        `      tovis-app: ${a[i] === undefined ? '(end of file)' : a[i].trim()}`,
        `      tovis-ios: ${b[i] === undefined ? '(end of file)' : b[i].trim()}`,
      ]
    }
  }
  return ['    (files differ only in trailing bytes)']
}

function main() {
  const missingLocally = PARITY_FIXTURES.filter((f) => !existsSync(resolve(f.web)))
  if (missingLocally.length > 0) {
    fail(
      missingLocally.flatMap((f) => [
        `${NAME}: ${f.web} is missing. Run \`${f.regen}\`.`,
      ]),
    )
  }

  const iosDir = locateIosRepo()
  if (!iosDir) {
    skip(
      process.env.TOVIS_IOS_DIR
        ? `TOVIS_IOS_DIR=${process.env.TOVIS_IOS_DIR} does not look like a tovis-ios checkout (no TovisTests/).`
        : 'No tovis-ios checkout found at ../tovis-ios or ~/Dev/tovis-ios.',
      'Set TOVIS_IOS_DIR=/path/to/tovis-ios to enforce this.',
    )
  }

  const ref = process.env.TOVIS_IOS_REF || DEFAULT_REF
  if (ref !== WORKTREE) {
    try {
      execFileSync('git', ['-C', iosDir, 'rev-parse', '--verify', `${ref}^{commit}`], {
        stdio: 'ignore',
        env: gitEnvForOtherRepo(),
      })
    } catch {
      skip(
        `tovis-ios has no ref '${ref}'.`,
        `Run \`git -C ${iosDir} fetch origin\`, or set TOVIS_IOS_REF=${WORKTREE} to compare the working tree.`,
      )
    }
  }

  const at = ref === WORKTREE ? 'worktree' : `${ref} (${shortSha(iosDir, ref)})`
  const problems = []

  for (const fixture of PARITY_FIXTURES) {
    const webText = readFileSync(resolve(fixture.web), 'utf8')
    const iosText = readAtRef(iosDir, ref, fixture.ios)

    if (iosText === null) {
      problems.push(
        `  ✗ ${fixture.what}`,
        `    tovis-ios ${at} has no ${fixture.ios}.`,
        '    Land the tovis-ios side FIRST (it is green on its own — its Swift',
        '    test drives only its own committed copy), then this goes green.',
      )
      continue
    }

    if (webText !== iosText) {
      problems.push(
        `  ✗ ${fixture.what}`,
        `    ${fixture.web} differs from tovis-ios ${at} ${fixture.ios}.`,
        ...describeDiff(webText, iosText),
        `    Fix: regenerate here (\`${fixture.regen}\`), copy the result to`,
        `    tovis-ios ${fixture.ios}, make its Swift test pass, and land THAT first.`,
      )
      continue
    }

    console.log(`✓ ${fixture.web} matches tovis-ios ${at}`)
  }

  if (problems.length > 0) {
    fail([
      `${NAME}: tovis-ios is not driving the same parity pairs as this branch.`,
      '',
      ...problems,
      '',
      'The Swift twin is only as good as the pairs it is tested against; a stale',
      'copy means the phone is being held to a rule this repo no longer has.',
    ])
  }

  console.log(`${NAME}: OK — ${PARITY_FIXTURES.length} parity fixture(s) in sync.`)
}

main()
