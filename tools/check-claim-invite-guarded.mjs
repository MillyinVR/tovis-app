// tools/check-claim-invite-guarded.mjs
//
// A route that can mail or text a claim link to a contact taken from the
// REQUEST BODY must bound how often it will do it.
//
// The gap this guard exists for (2026-08-22): `createClientClaimInviteDelivery`
// is the one helper that mints a client claim link and hands it to the
// notification drain for delivery as an SMS or an email. It had four
// route-reachable callers and only ONE of them enforced a ceiling:
//
//   app/api/v1/pro/clients/[id]/invite/route.ts   'pro:client-claim-invite'  ✅
//   app/api/v1/auth/register/route.ts             'auth:self-serve-claim'    ✅
//   app/api/v1/pro/bookings/[id]/invite/route.ts  none                       ❌
//   app/api/v1/pro/bookings/route.ts              none  (reaches it via
//                                                  lib/booking/createProBookingWithClient.ts)
//
// The registered bucket's own comment states the intent it could not deliver:
// "keyed per (pro, client) so a pro can batch-invite many DIFFERENT clients
// while no single client can be spammed with claim links." Two of the four
// doors walked straight past that ceiling, and both of them take the delivery
// address — `phone` and `email` — out of the POST body. The guarded door is
// additionally behind ENABLE_BOOKINGLESS_CLAIM, which production leaves unset,
// so in prod the only door with a ceiling on it was the one that 404s.
//
// Why no existing guard caught it:
//   - `check:rate-limit-buckets-wired` runs the other way round. It proves a
//     registered bucket is enforced SOMEWHERE, and 'pro:client-claim-invite'
//     was — at one of its four doors. Its own header says it "cannot tell you
//     that a surface NEEDS a bucket".
//   - `check:sms-send-guarded` owns Twilio VERIFY (the OTP primitives). Claim
//     links go out through the notification drain's Twilio Messages path, which
//     that guard deliberately does not cover.
//   - `check:no-private-lib-fork` needs a private name shadowing a canonical
//     exported one. There is no fork here: all four callers import the same
//     canonical helper. The divergence is in what they wrap it in.
//
// The rule, which was already true of every door that had been thought about:
//
//   Any file under app/api/**/route.ts that reaches
//   `createClientClaimInviteDelivery` — directly or through any chain of
//   in-repo imports — must itself call a rate limiter.
//
// Reachability is TRANSITIVE on purpose. `POST /api/v1/pro/bookings` never
// names the delivery helper; it calls `createProBookingWithClient`, which does.
// A guard matching only direct imports would have passed that route, which is
// the exact door that takes an arbitrary phone number.
//
// The limiter must be called in the ROUTE's own file. A limit applied deeper
// down would be invisible here, but it would also be invisible to the next
// person reading the route — and this whole class of defect is one of a control
// that exists somewhere and does not run on the path you are looking at.
//
// Zero exemptions as of this commit, deliberately: there is no baseline file.
// If you are adding a door, give it a ceiling rather than adding it to a list.
//
// Usage:
//   node tools/check-claim-invite-guarded.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

// The single helper that turns a claim token into an outbound SMS/email.
const CANONICAL_DELIVERY_MODULE =
  'lib/clientActions/createClientClaimInviteDelivery.ts'

// Limiter entry points that actually decide-and-refuse. Deliberately a short
// list: a route that bounds itself some other way is not covered, and should
// either use one of these or make its case in a PR — not widen this array.
const LIMITER_CALLS = [
  'enforceRateLimit(',
  'enforceVerificationSendThrottle(',
]

const SEARCH_DIRS = ['app', 'lib']

const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.claude',
  'node_modules',
  'dist',
  'build',
  'coverage',
])

const TARGET_EXTENSIONS = new Set(['.ts', '.tsx'])

// Naming a symbol while stubbing it is not passing a request through it.
const IGNORE_FILE_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.spec.ts',
  '.spec.tsx',
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
 * Strip comments before matching. This repo writes long explanatory headers —
 * including the one above, which names both the helper and the routes that were
 * missing a limiter. Without this, that prose would make the guard pass itself.
 * The type-escape guard has already been bitten by matching inside a comment.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

function main() {
  const files = []
  for (const dir of SEARCH_DIRS) {
    walk(path.join(ROOT, dir), files)
  }

  if (files.length === 0) {
    console.error(
      'check-claim-invite-guarded: walked ZERO files. That is a guard ' +
        'failure, not a clean tree — the search dirs moved. Fix this guard.',
    )
    process.exit(1)
  }

  /** @type {Set<string>} every repo-relative file the walk found */
  const known = new Set(files.map((f) => normalize(path.relative(ROOT, f))))

  if (!known.has(CANONICAL_DELIVERY_MODULE)) {
    console.error(
      `check-claim-invite-guarded: could not find ${CANONICAL_DELIVERY_MODULE}. ` +
        'That module is the anchor for the whole rule; if it moved or was ' +
        'renamed, update this guard rather than deleting it.',
    )
    process.exit(1)
  }

  /** @type {Map<string, string>} rel -> comment-stripped source */
  const codeOf = new Map()
  /** @type {Map<string, string[]>} rel -> in-repo imports, resolved */
  const importsOf = new Map()

  for (const rel of known) {
    let source
    try {
      source = fs.readFileSync(path.join(ROOT, rel), 'utf8')
    } catch {
      continue
    }

    const code = stripComments(source)
    codeOf.set(rel, code)

    const specs = [
      ...code.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g),
    ].map((m) => m[1])

    const resolved = []
    for (const spec of specs) {
      let base
      if (spec.startsWith('@/')) {
        base = spec.slice(2)
      } else if (spec.startsWith('.')) {
        base = normalize(path.normalize(path.join(path.dirname(rel), spec)))
      } else {
        continue // a package, not one of ours
      }

      for (const candidate of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ]) {
        if (known.has(candidate)) {
          resolved.push(candidate)
          break
        }
      }
    }

    importsOf.set(rel, resolved)
  }

  /** @type {Map<string, boolean>} rel -> reaches the delivery helper */
  const reaches = new Map()

  function reachesDelivery(rel, stack = new Set()) {
    if (rel === CANONICAL_DELIVERY_MODULE) return true
    const cached = reaches.get(rel)
    if (cached !== undefined) return cached
    if (stack.has(rel)) return false // cycle: this arm contributes nothing

    stack.add(rel)
    let found = false
    for (const dep of importsOf.get(rel) ?? []) {
      if (reachesDelivery(dep, stack)) {
        found = true
        break
      }
    }
    stack.delete(rel)

    // Only memoize a result computed without an open cycle above it; a `false`
    // produced by the cycle guard is about this traversal, not about the file.
    if (stack.size === 0) reaches.set(rel, found)
    return found
  }

  /** @type {string[]} */
  const guarded = []
  /** @type {string[]} */
  const unguarded = []

  for (const rel of [...known].sort()) {
    if (!rel.startsWith('app/api/') || !rel.endsWith('/route.ts')) continue
    if (!reachesDelivery(rel)) continue

    const code = codeOf.get(rel) ?? ''
    if (LIMITER_CALLS.some((call) => code.includes(call))) {
      guarded.push(rel)
    } else {
      unguarded.push(rel)
    }
  }

  const total = guarded.length + unguarded.length

  // A guard that stops finding its own subject passes vacuously forever.
  if (total === 0) {
    console.error(
      'check-claim-invite-guarded: found ZERO routes reaching ' +
        `${CANONICAL_DELIVERY_MODULE}. The rule would pass vacuously. Either ` +
        'the claim-invite paths were removed (delete this guard) or the import ' +
        'graph changed shape (fix it).',
    )
    process.exit(1)
  }

  if (unguarded.length > 0) {
    console.error(
      '\ncheck-claim-invite-guarded: route(s) that can send a claim link with ' +
        'NO rate limit:\n',
    )
    for (const rel of unguarded) {
      console.error(`  - ${rel}`)
    }
    console.error(
      '\nEach of these reaches createClientClaimInviteDelivery(), which mints a\n' +
        'claim token and enqueues it for delivery as an SMS or email — on most\n' +
        'of these routes, to a phone/email taken from the request body. Add a\n' +
        'ceiling in the route itself:\n\n' +
        "  const limited = await enforceRateLimit({\n" +
        "    bucket: 'pro:client-claim-invite',\n" +
        '    identity: tokenRateLimitIdentity(`${professionalId}:${clientId}`),\n' +
        '  })\n' +
        '  if (limited) return limited\n\n' +
        'Use the SAME bucket and the SAME key derivation as the existing doors:\n' +
        'a second key in the same bucket does not share the ceiling, it doubles\n' +
        'it.\n',
    )
    process.exit(1)
  }

  console.log(
    `check-claim-invite-guarded: passed (${total} claim-invite route(s), all rate limited)`,
  )
}

main()
