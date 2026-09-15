import { NotificationEventKey, Prisma } from '@prisma/client'

import {
  createProNotification,
  type ProNotificationCreateResult,
} from './proNotifications'

export type ViralRequestApprovedNotificationData = {
  viralRequestId: string
  requestName: string
  requestedCategoryId: string | null
  matchedServiceIds: string[]
}

export type CreateViralRequestApprovedProNotificationArgs = {
  professionalId: string
  viralRequestId: string
  requestName: string
  requestedCategoryId?: string | null
  matchedServiceIds: readonly string[]
  tx?: Prisma.TransactionClient
}

function normRequired(value: string, field: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(
      `createViralRequestApprovedProNotification: missing ${field}`,
    )
  }

  return trimmed
}

function normNullable(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normMatchedServiceIds(values: readonly string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  )
}

export function buildViralRequestApprovedProNotificationDedupeKey(
  viralRequestId: string,
): string {
  return `viral-request:${normRequired(viralRequestId, 'viralRequestId')}:approved`
}

export function buildViralRequestApprovedNotificationData(
  args: Omit<
    CreateViralRequestApprovedProNotificationArgs,
    'professionalId' | 'tx'
  >,
): ViralRequestApprovedNotificationData {
  return {
    viralRequestId: normRequired(args.viralRequestId, 'viralRequestId'),
    requestName: normRequired(args.requestName, 'requestName'),
    requestedCategoryId: normNullable(args.requestedCategoryId),
    matchedServiceIds: normMatchedServiceIds(args.matchedServiceIds),
  }
}

export async function createViralRequestApprovedProNotification(
  args: CreateViralRequestApprovedProNotificationArgs,
): Promise<ProNotificationCreateResult> {
  const professionalId = normRequired(args.professionalId, 'professionalId')
  const data = buildViralRequestApprovedNotificationData({
    viralRequestId: args.viralRequestId,
    requestName: args.requestName,
    requestedCategoryId: args.requestedCategoryId,
    matchedServiceIds: args.matchedServiceIds,
  })

  return createProNotification({
    professionalId,
    eventKey: NotificationEventKey.VIRAL_REQUEST_APPROVED,
    title: 'New viral request in your category',
    body: `"${data.requestName}" was approved and matches your services.`,
    // 🔴 Deliberately NO href, and the event declares `hrefShapes: []`.
    //
    // This used to send `/admin/viral-requests/{id}` — an ADMIN path on a PRO
    // notification, and one that 404s even for an admin: only the list page
    // `app/admin/viral-requests/page.tsx` exists, there is no `[id]` route. The
    // phone already declined it (the parser refuses all `/admin/*`), so the
    // whole destination was dead on both surfaces.
    //
    // There is nothing honest to point at instead: no pro-facing viral-request
    // surface exists, and the only read endpoints
    // (`/api/v1/viral-service-requests` and its `[id]`) are `requireClient()` —
    // they serve the client who submitted. Building that surface is a product
    // call, not a rename. Until it exists the pro gets the notice without a tap
    // target, which is what the body already says.
    dedupeKey: buildViralRequestApprovedProNotificationDedupeKey(
      data.viralRequestId,
    ),
    data,
    tx: args.tx,
  })
}