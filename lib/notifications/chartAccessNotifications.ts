// lib/notifications/chartAccessNotifications.ts
//
// W5 follow-up — the two notifications that make the chart-access loop an
// actual loop.
//
// W5 shipped the consent ROW and both write paths, but neither side was ever
// TOLD. A REQUESTED row is silent: the client learns about it only if they
// happen to open /client/settings. A GRANTED row is equally silent: the pro
// learns about it only by re-opening a chart that previously refused them. So
// the feature was reachable but not discoverable, which for a consent ask is
// the same as absent — see [[a-complete-feature-can-dead-end-at-its-entry-point]].
//
// Direction and audience are deliberately asymmetric:
//
//   requested → CLIENT   the person who has to answer
//   granted   → PRO      the person who asked
//   declined  → NOBODY   see below
//
// ⚠️ There is no decline notification, and that is a decision, not a gap. A
// client saying no to a request to read their allergies and their notes should
// not generate an event in the asker's inbox — that turns a private "no" into a
// notification the pro receives and can act on socially. The pro discovers the
// answer the same way they discover any other refusal: the chart still refuses,
// and `GET /chart-share` reports DECLINED with copy that says so.

import { NotificationEventKey } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { formatProfessionalPublicDisplayName } from '@/lib/privacy/professionalDisplayName'
import { formatClientName } from '@/lib/profiles/publicProfileFormatting'

import { createClientNotification } from './clientNotifications'
import { createProNotification } from './proNotifications'

/** Where the client answers. The ONLY surface that can act on the request. */
export const CHART_SHARE_SETTINGS_HREF = '/client/settings#chart-sharing'

export type ChartAccessRequestedNotificationData = {
  professionalId: string
}

export type ChartAccessGrantedNotificationData = {
  clientId: string
}

/**
 * One row per (client, pro) ask. Keyed on the PAIR, not on the request instant,
 * so a client who revoked and was later re-asked refreshes the single existing
 * inbox row instead of accumulating one row per ask. The request row itself is
 * already one-per-pair (`@@unique([clientId, professionalId])`), so a second
 * notification row would be describing a state that cannot exist twice.
 */
export function buildChartAccessRequestedDedupeKey(args: {
  clientId: string
  professionalId: string
}): string {
  return `chart-access-requested:${args.clientId}:${args.professionalId}`
}

export function buildChartAccessGrantedDedupeKey(args: {
  clientId: string
  professionalId: string
}): string {
  return `chart-access-granted:${args.clientId}:${args.professionalId}`
}

/**
 * Tell the CLIENT that a pro asked to read their chart.
 *
 * Names the pro by their PUBLIC display name — the same name the client already
 * sees on the thread and in their sharing settings. A request from "a
 * professional" is unanswerable; the client's decision is entirely about who is
 * asking.
 */
export async function notifyChartAccessRequested(args: {
  clientId: string
  professionalId: string
}): Promise<void> {
  const professional = await prisma.professionalProfile.findUnique({
    where: { id: args.professionalId },
    select: {
      businessName: true,
      firstName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
      lastName: true, // pii-plaintext-read-ok: pro public display name (formatProfessionalPublicDisplayName)
      handle: true,
      nameDisplay: true,
    },
  })

  // A pro that vanished between the request write and this read has nothing to
  // name. Skip rather than send "Professional asked to see your chart" — an
  // unattributable ask is worse than none, and the row is still in settings.
  if (!professional) return

  const professionalName = formatProfessionalPublicDisplayName(
    professional,
    'Professional',
  )

  const data: ChartAccessRequestedNotificationData = {
    professionalId: args.professionalId,
  }

  await createClientNotification({
    clientId: args.clientId,
    eventKey: NotificationEventKey.CHART_ACCESS_REQUESTED,
    title: `${professionalName} asked to see your chart`,
    body:
      'Your chart is the private record they keep about you — allergies, formulas, notes and consent forms. ' +
      'You can say yes or no, and you can turn it off again at any time.',
    href: CHART_SHARE_SETTINGS_HREF,
    dedupeKey: buildChartAccessRequestedDedupeKey(args),
    data,
  })
}

/**
 * Tell the PRO that the client said yes.
 *
 * Names the client, which is safe here in a way it is not in the other
 * direction: a grant means this pro may now read the chart, so the client's
 * name is strictly less than what they just consented to share.
 */
export async function notifyChartAccessGranted(args: {
  clientId: string
  professionalId: string
}): Promise<void> {
  const client = await prisma.clientProfile.findUnique({
    where: { id: args.clientId },
    select: {
      firstName: true, // pii-plaintext-read-ok: pro-facing client name, on a chart the pro may now read
      lastName: true, // pii-plaintext-read-ok: pro-facing client name, on a chart the pro may now read
    },
  })

  if (!client) return

  const data: ChartAccessGrantedNotificationData = { clientId: args.clientId }

  await createProNotification({
    professionalId: args.professionalId,
    eventKey: NotificationEventKey.CHART_ACCESS_GRANTED,
    title: `${formatClientName(client)} shared their chart with you`,
    body: 'You can now open their chart. They can turn this off again at any time.',
    href: `/pro/clients/${encodeURIComponent(args.clientId)}`,
    dedupeKey: buildChartAccessGrantedDedupeKey(args),
    data,
  })
}
