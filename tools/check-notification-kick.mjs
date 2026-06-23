// tools/check-notification-kick.mjs
//
// Tripwire for instant notification delivery.
//
// Notifications are enqueued and then drained — either by the every-minute cron
// or, for a snappy UX, immediately after the request commits via
// `kickNotificationDrain()` (lib/notifications/delivery/kickNotificationDrain).
//
// The risk this guard removes: a route that enqueues a user-facing notification
// but forgets the kick silently regresses to cron-only latency, invisibly. So
// any API route that calls a known notification-emitting function (either a
// direct emit helper or a write-boundary function that emits) MUST also call
// `kickNotificationDrain()`.
//
// Genuine exceptions (e.g. delivery is deliberately deferred to a background
// job, or the recipient isn't latency-sensitive) opt out with an inline comment
// containing `notification-kick-exempt` plus a short reason.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const API_DIR = path.join(ROOT, 'app', 'api')

function normalize(p) {
  return p.split(path.sep).join('/')
}

// Identifiers whose call in a route means a notification gets enqueued in that
// request. Direct emit helpers + the write-boundary functions that emit.
const EMIT_SIGNALS = [
  // Direct emit helpers called from routes.
  'createProNotification',
  'createConsultationDecisionNotification',
  'upsertClientNotification',
  'createClientNotification',
  'createClientClaimInviteDelivery',
  'createLookFollowerNewProNotification',
  'createClientFollowNotification',
  'emitAdminVerificationReviewNeeded',
  'emitAdminViralRequestPending',
  // Write-boundary functions that enqueue notifications as part of the mutation.
  'createProBookingWithClient',
  'finalizeBookingFromHold',
  'cancelBooking',
  'rescheduleBookingFromHold',
  'updateProBooking',
  'updateClientBookingCheckout',
  'markProBookingCheckoutPaid',
  'upsertBookingAftercare',
  'confirmBookingFinalReview',
  'confirmClientAftercareNextAppointment',
  'declineClientAftercareNextAppointment',
  'refundBookingPayment',
]

const KICK_TOKEN = 'kickNotificationDrain'
const OPT_OUT_TOKEN = 'notification-kick-exempt'

// Background-job / webhook routes drain on their own schedule or aren't bound to
// a user waiting on a response — not subject to the instant-kick rule.
const IGNORE_PATH_SEGMENTS = ['/internal/', '/webhooks/']

const IGNORE_FILE_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.d.ts']

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
      continue
    }
    if (!entry.isFile()) continue
    const ext = path.extname(full)
    if (ext !== '.ts' && ext !== '.tsx') continue
    if (IGNORE_FILE_SUFFIXES.some((s) => full.endsWith(s))) continue
    out.push(full)
  }
  return out
}

function callsSignal(content, signal) {
  // Match a call `signal(` (optionally with whitespace), not a bare import or a
  // `typeof signal>` type reference.
  return new RegExp(`\\b${signal}\\s*\\(`).test(content)
}

function main() {
  if (!fs.existsSync(API_DIR)) {
    console.log('Notification-kick guard passed (no app/api directory).')
    return
  }

  const files = walk(API_DIR)
  const violations = []

  for (const file of files) {
    const rel = normalize(path.relative(ROOT, file))
    if (IGNORE_PATH_SEGMENTS.some((seg) => `/${rel}`.includes(seg))) continue

    const content = fs.readFileSync(file, 'utf8')
    if (content.includes(KICK_TOKEN) || content.includes(OPT_OUT_TOKEN)) continue

    const matched = EMIT_SIGNALS.filter((signal) => callsSignal(content, signal))
    if (matched.length > 0) {
      violations.push({ file: rel, signals: matched })
    }
  }

  if (violations.length > 0) {
    console.error('\nNotification routes missing kickNotificationDrain():\n')
    for (const v of violations) {
      console.error(`- ${v.file}  (emits via: ${v.signals.join(', ')})`)
    }
    console.error(
      '\nThese routes enqueue a notification but never drain it, so the email/SMS\n' +
        'waits for the cron tick instead of going out immediately. Add\n' +
        "`kickNotificationDrain()` after the mutation commits (import from\n" +
        "'@/lib/notifications/delivery/kickNotificationDrain'), or, if the delay is\n" +
        'intentional, add an inline comment containing `notification-kick-exempt`\n' +
        'with a short reason.\n',
    )
    process.exit(1)
  }

  console.log('Notification-kick guard passed.')
}

main()
