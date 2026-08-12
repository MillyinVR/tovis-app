#!/usr/bin/env node
// tools/check-ios-fixture-contract.mjs
//
// The cross-repo half of the wire contract: fails a tovis-app change whose
// generated API schema would break the tovis-ios test fixtures.
//
// The risk this guard removes: `check:api-schema` proves the committed schema
// matches lib/dto/index.ts, which is drift WITHIN this repo. Nothing here knew
// tovis-ios existed. Meanwhile tovis-ios CI validates its fixtures against this
// repo's schema read LIVE from `main` — so the whole cross-repo check lived on
// the other side of the wall, and only ever fired on an iOS push:
//
//   1. A web PR adds a field to a DTO and runs `gen:api-schema`. The generator
//      marks it REQUIRED.
//   2. Web CI is green — nothing here knows about iOS fixtures. It merges.
//   3. Every iOS fixture for that type fails on tovis-ios `main` the instant it
//      lands (`must have required property '…'`), and the next iOS PR inherits
//      a red check it did not cause.
//
// That is not hypothetical: `ConsultIntakeStateDTO` gained a required
// `progress` and `ConsultIntakeQuestionDTO` a required `helpText`; tovis-ios
// main went red and iOS #300 inherited it. Patching the fixture there fixed the
// symptom. This guard is the mechanism — the breakage now fails on the PR that
// causes it.
//
// It does NOT impose a merge order. The generator runs with
// `--additional-properties`, so no definition sets `additionalProperties:
// false` (asserted below, not assumed) — a fixture carrying the new field
// validates against the OLD schema too. So the fix is always: bump the iOS
// fixtures FIRST, merge that, and either side can then land whenever.
//
// It also does not reimplement validation. It runs tovis-ios's own
// `scripts/contract/validate-fixtures.mjs` — the same script, the same CHECKS
// list, the same ajv — pointed at THIS branch's schema.
//
// Knobs:
//   TOVIS_IOS_DIR   where tovis-ios is checked out. Default: ../tovis-ios, then
//                   ~/Dev/tovis-ios.
//   TOVIS_IOS_REF   which iOS revision to validate. Default `origin/main` —
//                   that is the ref this change would redden, and it is the
//                   only honest answer to "would merging this break iOS main?".
//                   Set to `worktree` to validate the checkout in place (what
//                   CI does, where the checkout already IS main).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const NAME = 'check-ios-fixture-contract'
const SCHEMA = resolve('schema/api/tovis-api.schema.json')
const FIXTURES_PATH = 'TovisKit/Tests/TovisKitTests/Fixtures'
const CONTRACT_PATH = 'scripts/contract'
const VALIDATOR = 'validate-fixtures.mjs'
const DEFAULT_REF = 'origin/main'
const WORKTREE = 'worktree'

/**
 * Exit 0, loudly. This guard is best effort by design: not everyone has both
 * repos checked out. A silent skip would be the "manufactures confidence"
 * failure, so every skip says what it did not check and how to enable it.
 */
function skip(reason, remedy) {
  console.log(`${NAME}: SKIPPED — NOT ENFORCED.`)
  console.log(`  ${reason}`)
  if (remedy) console.log(`  ${remedy}`)
  console.log(
    '  A tovis-app DTO change can still redden tovis-ios main from here.',
  )
  process.exit(0)
}

function fail(lines) {
  for (const line of lines) console.error(line)
  process.exit(1)
}

/**
 * First candidate that actually contains the iOS contract validator.
 *
 * An explicit TOVIS_IOS_DIR is authoritative: if it is set and wrong, skip
 * naming THAT path rather than quietly validating some other checkout, which
 * would report a green for a repo the caller never asked about.
 */
function locateIosRepo() {
  const hasValidator = (dir) => existsSync(join(dir, CONTRACT_PATH, VALIDATOR))

  if (process.env.TOVIS_IOS_DIR) {
    const dir = resolve(process.env.TOVIS_IOS_DIR)
    return hasValidator(dir) ? dir : null
  }

  for (const dir of [
    resolve(process.cwd(), '..', 'tovis-ios'),
    join(homedir(), 'Dev', 'tovis-ios'),
  ]) {
    if (hasValidator(dir)) return dir
  }
  return null
}

/**
 * Does any definition in this branch's schema forbid extra properties?
 *
 * This is what makes a clean fix possible, so the guard checks it rather than
 * repeating it as folklore: if nothing forbids extras, a fixture carrying a
 * newly-required field still validates against the schema on main, and the two
 * PRs can land in either order.
 */
function definitionsForbiddingExtras(schemaText) {
  const found = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`))
      return
    }
    if (node.additionalProperties === false) found.push(path || '(root)')
    for (const [key, value] of Object.entries(node)) walk(value, `${path}/${key}`)
  }
  walk(JSON.parse(schemaText), '')
  return found
}

function shortSha(iosDir, ref) {
  try {
    return execFileSync('git', ['-C', iosDir, 'rev-parse', '--short', ref], {
      encoding: 'utf8',
    }).trim()
  } catch {
    return ref
  }
}

/**
 * Extract `ref`'s fixtures + contract scripts into a temp dir and point the
 * validator's ajv at the iOS checkout's already-installed copy. The validator
 * resolves its fixtures directory relative to its own location, so both trees
 * have to come out of the archive together.
 */
function materializeRef(iosDir, ref) {
  const tar = execFileSync(
    'git',
    ['-C', iosDir, 'archive', '--format=tar', ref, '--', FIXTURES_PATH, CONTRACT_PATH],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  const dir = mkdtempSync(join(tmpdir(), 'ios-fixture-contract-'))
  try {
    const extract = spawnSync('tar', ['-x', '-C', dir], { input: tar })
    if (extract.status !== 0) {
      throw new Error(`tar exited ${extract.status} extracting ${ref}`)
    }
    symlinkSync(
      join(iosDir, CONTRACT_PATH, 'node_modules'),
      join(dir, CONTRACT_PATH, 'node_modules'),
    )
    return dir
  } catch (err) {
    rmSync(dir, { recursive: true, force: true })
    throw err
  }
}

function main() {
  if (!existsSync(SCHEMA)) {
    fail([
      `${NAME}: ${SCHEMA} is missing. Run \`npm run gen:api-schema\`.`,
    ])
  }

  const iosDir = locateIosRepo()
  if (!iosDir) {
    skip(
      process.env.TOVIS_IOS_DIR
        ? `TOVIS_IOS_DIR=${process.env.TOVIS_IOS_DIR} holds no ${CONTRACT_PATH}/${VALIDATOR}, so the iOS wire fixtures were not validated.`
        : 'tovis-ios is not checked out next to this repo, so its wire fixtures were not validated.',
      'Point TOVIS_IOS_DIR at a tovis-ios checkout (or clone it to ../tovis-ios) to enable this check.',
    )
  }

  if (!existsSync(join(iosDir, CONTRACT_PATH, 'node_modules', 'ajv'))) {
    skip(
      `${iosDir}/${CONTRACT_PATH} has no ajv installed, so its fixtures were not validated.`,
      `Run \`npm ci --prefix ${iosDir}/${CONTRACT_PATH}\`.`,
    )
  }

  const ref = process.env.TOVIS_IOS_REF || DEFAULT_REF
  const useWorktree = ref === WORKTREE

  if (!useWorktree) {
    const resolved = spawnSync(
      'git',
      ['-C', iosDir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      { encoding: 'utf8' },
    )
    if (resolved.status !== 0) {
      skip(
        `tovis-ios has no revision '${ref}', so its fixtures were not validated.`,
        `Run \`git -C ${iosDir} fetch origin\`, or set TOVIS_IOS_REF=${WORKTREE} to check the working tree instead.`,
      )
    }
  }

  let tmpDir = null
  let runDir
  try {
    if (useWorktree) {
      runDir = join(iosDir, CONTRACT_PATH)
    } else {
      tmpDir = materializeRef(iosDir, ref)
      runDir = join(tmpDir, CONTRACT_PATH)
    }

    // tovis-ios's own validator, its own CHECKS list, its own ajv — pointed at
    // this branch's schema instead of the one on tovis-app main.
    const run = spawnSync(process.execPath, [VALIDATOR], {
      cwd: runDir,
      env: { ...process.env, TOVIS_API_SCHEMA: SCHEMA },
      encoding: 'utf8',
    })

    const where = useWorktree
      ? `${iosDir} (working tree)`
      : `tovis-ios ${ref} (${shortSha(iosDir, ref)})`

    // Exit code alone cannot tell a drift from a crash: the validator exits 1
    // for drifted fixtures, and an uncaught throw in it exits 1 too. It does
    // print this sentinel on every failure it MEANS, and never on a crash — so
    // read its output rather than its status. Reporting "fixtures drifted"
    // because node blew up would be a lie, and would send someone off to bump a
    // fixture that is perfectly fine.
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
    const isDrift =
      !run.error &&
      run.status === 1 &&
      output.includes('Contract validation FAILED')

    if (run.status !== 0 && !isDrift) {
      fail([
        run.stdout ?? '',
        run.stderr ?? '',
        '',
        `${NAME}: FAILED — could not run tovis-ios's validate-fixtures.mjs`,
        `  ${run.error?.message ?? `exited with status ${run.status}, signal ${run.signal}`}`,
        `  validator: ${join(runDir, VALIDATOR)}`,
        `  schema:    ${SCHEMA}`,
        '  This is the guard failing to answer, not a fixture drift — fix the',
        '  invocation above before reading anything into it.',
      ])
    }

    if (run.status === 0) {
      const summary = (run.stdout ?? '')
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('Contract OK'))
        .pop()
      console.log(`${NAME}: passed — ${summary ?? 'fixtures validate'} [${where}]`)
      return
    }

    const forbidding = definitionsForbiddingExtras(readFileSync(SCHEMA, 'utf8'))
    const bothOrdersSafe = forbidding.length === 0

    fail([
      run.stdout ?? '',
      run.stderr ?? '',
      '',
      '────────────────────────────────────────────────────────────────',
      `${NAME}: FAILED`,
      '',
      `This branch's schema/api/tovis-api.schema.json does not validate the wire`,
      'fixtures on:',
      `    ${where}`,
      'Merging it turns tovis-ios main RED, and the next iOS PR inherits a failure',
      'it did not cause.',
      '',
      'HOW TO FIX — the tovis-ios side goes FIRST:',
      '',
      ' 1. Use the value the SERVER actually sends. A fixture that type-checks but',
      '    lies is the thing this gate exists to prevent, so do NOT paste "" or',
      '    null to make the error go away: read the code in THIS repo that',
      '    produces the field and copy the real value. When',
      '    ConsultIntakeQuestionDTO gained `helpText`, the honest fixture value was',
      '    TREATMENT_HISTORY_HELP verbatim out of lib/consult/intakePack.ts.',
      '    Put a non-null value in at least one fixture per surface — an all-null',
      '    bump passes here while the field is never actually read.',
      '',
      ' 2. 🔴 Edit the fixture with a TEXTUAL INSERT — never json.dump, never a',
      '    formatter. Several fixtures use compact one-object-per-line JSON, and a',
      '    reformat turns an 11-line change into a 445-line diff. tovis-ios 43ffe8e',
      '    is the shape of a correct edit.',
      '',
      ' 3. Check the bump against BOTH schemas before merging anything:',
      '',
      `      cd ${iosDir}/${CONTRACT_PATH}`,
      `      TOVIS_API_SCHEMA=${SCHEMA} npm run validate`,
      '      git -C ' +
        process.cwd() +
        ' show origin/main:schema/api/tovis-api.schema.json > /tmp/main-schema.json',
      '      TOVIS_API_SCHEMA=/tmp/main-schema.json npm run validate',
      '',
      bothOrdersSafe
        ? '    Both green means no merge order opens a red window: this branch sets\n' +
          '    `additionalProperties: false` on no definition, so a fixture carrying\n' +
          '    the new field still validates against the schema on main.'
        : '    ⚠️  This branch DOES set `additionalProperties: false` on ' +
          `${forbidding.length} definition(s)\n` +
          '    (e.g. ' +
          `${forbidding[0]}), so the escape above no longer holds — a fixture\n` +
          '    carrying the new field may now FAIL against main. Coordinate the two\n' +
          '    merges deliberately instead of relying on either order being safe.',
      '',
      ' 4. Merge the tovis-ios fixture PR, then re-run this guard here.',
      '',
      "If the failure above is `schema has no definition '…'` rather than a",
      'missing property, this change removed or renamed a DTO the iOS fixtures',
      'are pinned to — restore the export in lib/dto/index.ts, or land the',
      "matching rename in tovis-ios's scripts/contract/validate-fixtures.mjs",
      'CHECKS list first.',
      '',
      'Not every route is in the DTO barrel (GET /pro/clients, /pro/bookings/[id],',
      '/pro/waitlist are not), so fields added to those create no fixture work at',
      'all. `npm run check:api-schema` tells you whether you changed the schema.',
      '────────────────────────────────────────────────────────────────',
    ])
  } finally {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  }
}

main()
