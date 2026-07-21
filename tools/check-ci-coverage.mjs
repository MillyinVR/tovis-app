// tools/check-ci-coverage.mjs
//
// Tripwire for test/guard scripts that no longer run anywhere.
//
// The risk this guard removes: a script exists in package.json, looks like
// coverage, and is invoked by nothing. It rots silently — no red build ever
// tells you, because it never runs. That is not hypothetical here:
// `test:integration` sat unwired long enough for its cleanup to drift behind
// the schema AND for the signup suite to fall behind a route contract change,
// taking with it the only end-to-end proof that the booking overlap EXCLUDE
// constraints work (see docs/design/scheduling-conflict-audit-fix-plan.md, F11).
// `pnpm lint` was in the same state despite CLAUDE.md mandating it.
//
// So: every `test:*` / `check:*` / `verify:*` script, plus `lint` and
// `typecheck`, must be reachable from a GitHub workflow — directly, or through
// an aggregate script that is itself reachable (e.g. the twelve `check:*`
// guards run via `check:static-guards`).
//
// A script that genuinely should not run in CI goes in MANUAL_ONLY *with a
// reason*. That is the point of this guard: it converts silent drift into an
// explicit, reviewable decision. The allowlist is kept honest in both
// directions — an entry naming a script that no longer exists fails, and so
// does an entry for a script that IS wired up (delete it and move on).

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows')
const PACKAGE_JSON = path.join(ROOT, 'package.json')

/**
 * Scripts deliberately NOT run in CI. Key = script name, value = why.
 * Adding an entry is a decision, not a formality — say what makes CI wrong for
 * it, so the next person can tell a real exemption from an abandoned one.
 */
const MANUAL_ONLY = {
  // --- interactive / local-developer variants -----------------------------
  'test:watch': 'Interactive watch mode; the one-shot `test` runs in CI.',
  'test:e2e':
    'Local Playwright entry point. e2e.yml drives `pnpm exec playwright test --project=…` directly so it can matrix over browsers.',
  'test:e2e:headed': 'Local debugging only (opens a browser).',
  'test:e2e:ui': 'Local debugging only (opens the Playwright UI).',
  'test:e2e:debug': 'Local debugging only (Playwright inspector).',
  'test:e2e:install': 'Local browser install; CI installs via its own step.',
  'test:e2e:local':
    'Points at localhost + layered local env files; CI uses the built server.',
  'test:e2e:ci':
    'Thin wrapper kept for parity; e2e.yml invokes Playwright directly with a --project matrix.',
  'test:integration':
    'Local harness — requires the gitignored .env.test.local. CI runs `test:integration:ci`.',
  'test:integration:booking-overlap':
    'Focused local subset of the integration suite, which CI runs in full.',

  // --- curated aliases over suites CI already runs -------------------------
  'test:privacy':
    'Alias for the two privacy subsets below; both are plain vitest files already covered by `pnpm test`.',
  'test:privacy-phase1':
    'Curated subset of files `pnpm test` already runs; exists for focused local runs.',
  'test:privacy-export-delete':
    'Curated subset of files `pnpm test` already runs; exists for focused local runs.',
  'verify:privacy-phase1':
    'Alias over check:privacy-guards + test:privacy, both already covered in CI.',
  'check:privacy-guards':
    'Alias for two guards that already run via check:static-guards.',

  // --- costs real money or needs production-shaped secrets ----------------
  'test:chaos': 'Needs .env.local; fault-injection is run deliberately, not per-PR.',
  'test:load:signup': 'Load test — can bill real Twilio/Postmark. Run deliberately.',
  'test:load:availability': 'Load test — run deliberately against staging.',
  'test:load:holds': 'Load test — run deliberately against staging.',
  'test:load:booking-finalize': 'Load test — run deliberately against staging.',
  'test:load:checkout': 'Load test — run deliberately against staging.',
  'test:load:launch': 'Load-suite aggregate — run deliberately against staging.',
  'test:load:media-metadata': 'Load test — run deliberately against staging.',
  'test:load:notifications':
    'Load test — can bill real Twilio/Postmark. Run deliberately.',
  'test:load:stripe-webhook-replay':
    'Load test — replays Stripe webhooks; run deliberately.',
  'verify:launch-ops':
    'Aggregate of chaos + load suites; both are deliberate, pre-launch runs.',
}

/** Scripts that must be reachable from CI. */
function isRequired(name) {
  if (name === 'lint' || name === 'typecheck') return true
  return /^(test|check|verify)(:|$)/.test(name)
}

/**
 * Script names invoked by a blob of shell/YAML text.
 * Matches `pnpm <name>`, `pnpm run <name>`, `npm run <name>`, `yarn <name>`.
 * `pnpm exec <bin>` intentionally yields the binary name, which simply won't
 * match any script and is ignored.
 */
function invokedScriptNames(text) {
  const found = new Set()
  const re = /\b(?:pnpm|npm|yarn)\s+(?:run\s+|exec\s+)?([a-zA-Z][\w:.-]*)/g
  let match
  while ((match = re.exec(text)) !== null) found.add(match[1])
  return found
}

function readWorkflowText() {
  if (!fs.existsSync(WORKFLOW_DIR)) return ''
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8'))
    .join('\n')
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))
  const scripts = pkg.scripts ?? {}
  const scriptNames = new Set(Object.keys(scripts))

  // Seed: script names any workflow invokes directly.
  const covered = new Set(
    [...invokedScriptNames(readWorkflowText())].filter((n) =>
      scriptNames.has(n),
    ),
  )

  // Transitive closure: an aggregate that runs in CI covers what it calls.
  let grew = true
  while (grew) {
    grew = false
    for (const name of [...covered]) {
      for (const child of invokedScriptNames(scripts[name] ?? '')) {
        if (scriptNames.has(child) && !covered.has(child)) {
          covered.add(child)
          grew = true
        }
      }
    }
  }

  const required = [...scriptNames].filter(isRequired).sort()

  const unwired = required.filter(
    (n) => !covered.has(n) && !(n in MANUAL_ONLY),
  )
  const staleMissing = Object.keys(MANUAL_ONLY).filter(
    (n) => !scriptNames.has(n),
  )
  const staleCovered = Object.keys(MANUAL_ONLY).filter((n) => covered.has(n))

  let failed = false

  if (unwired.length > 0) {
    failed = true
    console.error('\nScripts that run in NO GitHub workflow:\n')
    for (const n of unwired) console.error(`- ${n}`)
    console.error(
      '\nA test or guard nothing invokes cannot fail, so it rots without ever\n' +
        'going red. Either wire it into a workflow in .github/workflows/ (directly\n' +
        'or via an aggregate that already runs), or add it to MANUAL_ONLY in\n' +
        'tools/check-ci-coverage.mjs WITH A REASON explaining why CI is the wrong\n' +
        'place for it.\n',
    )
  }

  if (staleMissing.length > 0) {
    failed = true
    console.error('\nMANUAL_ONLY entries for scripts that no longer exist:\n')
    for (const n of staleMissing) console.error(`- ${n}`)
    console.error('\nRemove them from tools/check-ci-coverage.mjs.\n')
  }

  if (staleCovered.length > 0) {
    failed = true
    console.error('\nMANUAL_ONLY entries that ARE wired into CI:\n')
    for (const n of staleCovered) console.error(`- ${n}`)
    console.error(
      '\nThese now run in CI, so the exemption is misleading. Delete the entry.\n',
    )
  }

  if (failed) process.exit(1)

  console.log(
    `check-ci-coverage: passed (${required.length - Object.keys(MANUAL_ONLY).length} scripts wired, ${Object.keys(MANUAL_ONLY).length} deliberately manual)`,
  )
}

main()
