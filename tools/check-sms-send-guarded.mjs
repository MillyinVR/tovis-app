// tools/check-sms-send-guarded.mjs
//
// A billable SMS send may not exist outside the two controls that bound what it
// can cost and where it can go.
//
// The incident this guard exists for (2026-08-21): `POST /api/v1/auth/
// resend-phone-code` and `POST /api/v1/auth/verify-phone-code` were live in
// production, unauthenticated, and called Twilio Verify directly through a
// private fork (`lib/auth/phoneVerification.ts`) instead of the canonical
// `lib/twilio/verify.ts`. Going around the canonical module meant going around
// everything layered on top of it: `requireUser`, the send throttle
// (`auth:email:send` per IP + `auth:sms-phone-hour`/`-day` per phone) and —
// the expensive one — `validateSmsDestinationCountry`, whose allowlist defaults
// to US only. The fork's sole check was that the number began with `+`, so any
// unauthenticated caller could pump SMS to any country on earth, unbounded, on
// Tovis's Twilio bill. Zero clients had ever called either route: never present
// in any of 2,820 blobs across 668 commits of tovis-ios, and web's own
// verify-phone page uses the canonical `phone/send` + `phone/verify` siblings.
//
// Neither existing guard could see it. `check:rate-limit-buckets-wired` runs the
// other way round — it proves a registered bucket is enforced *somewhere*, and
// says so in its own header: it "cannot tell you that a surface NEEDS a bucket".
// `check:no-private-lib-fork` only fires on a PRIVATE declaration shadowing a
// canonical exported name; the fork exported `sendPhoneVerificationCode` while
// the canonical exports `startTwilioVerifyPhoneVerification`, so two different
// exported names reading as two different helpers disarmed it.
//
// The two rules below are the invariant that was already true of every
// legitimate send site, and false only of the fork:
//
//   1. ONE OWNER — Twilio Verify's billable primitives (`verifications.create`,
//      `verificationChecks.create`) may only be called from lib/twilio/verify.ts.
//      A second module reaching for the SDK directly is the fork, re-appearing.
//
//   2. NO SEND WITHOUT A DESTINATION CHECK — any module that calls
//      `startTwilioVerifyPhoneVerification` must also call
//      `validateSmsDestinationCountry`. The country allowlist is enforced at the
//      call site, not inside the canonical module, so importing the canonical
//      one is NOT by itself enough to be safe.
//
// Both rules hold with ZERO exemptions as of this commit — there is no baseline
// here on purpose. If you are adding a send site, add the country check next to
// it rather than adding yourself to a list.
//
// Usage:
//   node tools/check-sms-send-guarded.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

// The single module allowed to touch the Twilio Verify SDK's send/check calls.
const CANONICAL_SEND_MODULE = 'lib/twilio/verify.ts'

// The SDK primitives that actually spend money / deliver a message.
const BILLABLE_PRIMITIVES = ['verifications.create', 'verificationChecks.create']

// Rule 2's pair: calling the left one obliges you to call the right one.
const SEND_HELPER = 'startTwilioVerifyPhoneVerification'
const COUNTRY_GUARD = 'validateSmsDestinationCountry'

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

// A test may legitimately name either symbol while stubbing it; naming a symbol
// is not passing a request through it.
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
 * Strip `//` and block comments before matching, so a header explaining the
 * rule (this repo writes long ones) cannot itself trip the guard. The same
 * class of false positive has bitten here before: the type-escape guard once
 * matched its forbidden two-word pattern INSIDE a longer word, in a comment —
 * a Tailwind class ending in "-as" followed by "any caller". The fix there was
 * to reword the prose, never to widen the guard; stripping comments first is
 * the same fix applied ahead of time.
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
      'check-sms-send-guarded: walked ZERO files. That is a guard failure, ' +
        'not a clean tree — the search dirs moved. Fix this guard.',
    )
    process.exit(1)
  }

  /** @type {string[]} rule 1 violations: `rel` */
  const forkedSendSites = []
  /** @type {string[]} rule 2 violations: `rel` */
  const uncheckedSendSites = []

  let canonicalSeen = false
  let sendHelperSites = 0

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))

    let source
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }

    const code = stripComments(source)

    // ── Rule 1 — one owner for the billable primitives ──────────────────────
    const touchesPrimitive = BILLABLE_PRIMITIVES.some((primitive) =>
      code.includes(primitive),
    )

    if (rel === CANONICAL_SEND_MODULE) {
      canonicalSeen = true
    } else if (touchesPrimitive) {
      forkedSendSites.push(rel)
    }

    // ── Rule 2 — a send site must check the destination country ─────────────
    // The canonical module is exempt: it IS the send, and the country check is
    // applied by its callers (which is exactly why rule 2 has to exist).
    if (rel !== CANONICAL_SEND_MODULE && code.includes(SEND_HELPER)) {
      sendHelperSites += 1
      if (!code.includes(COUNTRY_GUARD)) {
        uncheckedSendSites.push(rel)
      }
    }
  }

  // A guard that silently stops finding its own subject is a guard that passes
  // vacuously forever. Fail loudly instead.
  if (!canonicalSeen) {
    console.error(
      `check-sms-send-guarded: could not find ${CANONICAL_SEND_MODULE}. The ` +
        'canonical Twilio Verify module is the anchor for both rules; if it ' +
        'moved, update this guard rather than deleting it.',
    )
    process.exit(1)
  }

  if (sendHelperSites === 0) {
    console.error(
      `check-sms-send-guarded: found ZERO call sites for ${SEND_HELPER}(). ` +
        'Rule 2 would pass vacuously. Either the helper was renamed (update ' +
        'this guard) or every send path was removed (delete this guard).',
    )
    process.exit(1)
  }

  let failed = false

  if (forkedSendSites.length > 0) {
    failed = true
    console.error(
      '\ncheck-sms-send-guarded: Twilio Verify called OUTSIDE the canonical module:\n',
    )
    for (const rel of forkedSendSites) {
      console.error(`  - ${rel}`)
    }
    console.error(
      `\nOnly ${CANONICAL_SEND_MODULE} may call ${BILLABLE_PRIMITIVES.join(' / ')}.\n` +
        'Reaching for the SDK directly skips the throttle and the SMS country\n' +
        'allowlist that every real send path applies. Import\n' +
        `  ${SEND_HELPER}() from '@/lib/twilio/verify'\n` +
        'instead.\n',
    )
  }

  if (uncheckedSendSites.length > 0) {
    failed = true
    console.error(
      `\ncheck-sms-send-guarded: ${SEND_HELPER}() called without ${COUNTRY_GUARD}():\n`,
    )
    for (const rel of uncheckedSendSites) {
      console.error(`  - ${rel}`)
    }
    console.error(
      '\nThe country allowlist is applied at the CALL SITE, not inside the\n' +
        'canonical module, so importing the canonical send is not by itself\n' +
        'safe. Validate before sending:\n' +
        `  const country = ${COUNTRY_GUARD}(phone)\n` +
        "  if (!country.ok) return jsonFail(400, country.message, { code: country.code })\n",
    )
  }

  if (failed) {
    process.exit(1)
  }

  console.log(
    `check-sms-send-guarded: passed (1 canonical send module, ` +
      `${sendHelperSites} send sites, all country-checked)`,
  )
}

main()
