// lib/notifications/hrefShapeGuard.ts
//
// Keeps `hrefShapes` on the event definitions HONEST.
//
// The declaration in `eventKeys.ts` is what forces a new event key to say which
// hrefs it emits — but a declaration is only a claim. Nothing stops it from
// being wrong: someone changes an emitter's href and leaves the declaration
// alone, and the registry quietly describes a set the code no longer produces.
// The iOS test would then keep proving the phone routes shapes nobody sends,
// while the shape actually being sent goes unrouted. That is the original bug
// with extra paperwork.
//
// So every notification write boundary calls this with the key it is writing
// and the href it resolved. Outside production it THROWS on a mismatch, which
// means any test that exercises an emitter — and there are many — checks the
// declaration against reality for free.
//
// In production it never throws. A notification failing to send because its
// destination is undeclared would be a far worse outcome than the dead tap this
// whole mechanism exists to prevent; the href has already been sanitized by
// `normInternalHref` either way. It reports to Sentry at `warning` instead.
//
// ⚠️ Read that boundary literally: it is NODE_ENV, so it is local `next dev`
// and the test runner that throw. Every Vercel build — PREVIEW INCLUDED — runs
// with NODE_ENV=production and therefore only reports. A preview deployment is
// not a second line of defence here; the test suite is the line of defence, and
// it works because the suite exercises the emitters.
//
// Lives in its own module rather than in `hrefShapes.ts` because it needs the
// event definitions, and `eventKeys.ts` imports the shape type — putting the
// value import there too would close an import cycle.

import type { NotificationEventKey } from '@prisma/client'

import { captureNotificationException } from '@/lib/observability/notificationEvents'

import { getNotificationEventDefinition } from './eventKeys'
import { notificationHrefShape } from './hrefShapes'

/**
 * The tag every one of these carries — in a thrown message and in the Sentry
 * report alike — so both are findable by one search.
 */
export const NOTIFICATION_HREF_SHAPE_WARNING = '[notification-href-shape]'

/**
 * True when an undeclared href should throw rather than report.
 *
 * `test` and `development` throw; everything else reports. Note this is NOT
 * "local vs deployed" — a Vercel preview build is NODE_ENV=production too, so
 * previews report rather than throw.
 */
function shouldThrow(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function message(
  eventKey: NotificationEventKey,
  href: string,
  reason: string,
): string {
  return [
    `${NOTIFICATION_HREF_SHAPE_WARNING} ${eventKey} emitted an href that ${reason}:`,
    `  href: ${JSON.stringify(href)}`,
    '',
    'Every notification href must reduce to a shape declared in',
    'lib/notifications/hrefShapes.ts, and that shape must be listed in this',
    "event's `hrefShapes` in lib/notifications/eventKeys.ts.",
    '',
    'This is not bookkeeping. tovis-ios drives its REAL deep-link parser over',
    'that registry; a shape missing from it is a shape the phone was never',
    'checked against, and the parser answers undeclared /client/* and /pro/*',
    'paths with `.clientHome` / `.proHome` — non-nil, so the notification',
    'centre dismisses itself onto Home instead of leaving the tap harmless.',
    '',
    'Fix: add the shape (with its `surface`) to NOTIFICATION_HREF_SHAPES, list',
    "it on this event, run `pnpm gen:notification-href-fixture`, and land the",
    'tovis-ios side first so its parser is proven to handle it.',
  ].join('\n')
}

/**
 * Assert that `href` is a shape this event key declared.
 *
 * An empty href is fine everywhere — it means the row simply has no
 * destination, which `normInternalHref` also produces for anything it rejects.
 * Returns the href so it can be used inline at a write boundary.
 */
export function assertNotificationHrefShape(
  eventKey: NotificationEventKey,
  href: string,
): string {
  if (href.length === 0) return href

  const shape = notificationHrefShape(href)
  const declared = getNotificationEventDefinition(eventKey).hrefShapes

  const problem =
    shape === null
      ? 'matches no shape in the registry'
      : declared.includes(shape)
        ? null
        : `reduces to ${shape}, which this event does not declare`

  if (problem === null) return href

  const text = message(eventKey, href, problem)
  if (shouldThrow()) throw new Error(text)

  // 'warning', not 'error': the notification still sends and the href is still
  // a sanitized internal path. What is degraded is the CONTRACT — the phone was
  // never checked against this destination — which is worth seeing without
  // paging as loudly as a failed send.
  captureNotificationException({
    error: new Error(text),
    route: 'notifications/hrefShapeGuard',
    event: eventKey,
    level: 'warning',
  })
  return href
}
