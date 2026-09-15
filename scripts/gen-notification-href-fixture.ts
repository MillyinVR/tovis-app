// scripts/gen-notification-href-fixture.ts
//
// Writes schema/parity/notificationHrefShapes.json from the href registry.
// Run via `pnpm gen:notification-href-fixture`. The committed result is what
// tovis-ios drives its real deep-link parser over, so regenerating it is how a
// new notification destination reaches the phone's test suite.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  NOTIFICATION_HREF_FIXTURE_PATH,
  renderNotificationHrefFixture,
} from '../lib/notifications/hrefShapesFixture'

const target = resolve(process.cwd(), NOTIFICATION_HREF_FIXTURE_PATH)
writeFileSync(target, renderNotificationHrefFixture(), 'utf8')
console.log('wrote ' + NOTIFICATION_HREF_FIXTURE_PATH)
