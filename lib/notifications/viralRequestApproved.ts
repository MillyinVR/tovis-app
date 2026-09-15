import { NotificationEventKey, Prisma } from '@prisma/client'

import { PRO_VIRAL_REQUESTS_PATH } from '@/lib/routes'

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
    // The pro's own viral-requests library, where they can answer this notice
    // with "I can do this" (#1191).
    //
    // This sent `/admin/viral-requests/{id}` until #1189 — an ADMIN path on a
    // PRO notification, and one that 404s even for an admin: only the list page
    // `app/admin/viral-requests/page.tsx` exists, there is no `[id]` route.
    // #1189 removed it rather than invent a destination, because none existed:
    // the only read endpoints were `requireClient()`, serving the submitter.
    //
    // 🔴 Never point a PRO notice at an `/admin/*` route again — that was the
    // original defect, and the shape registry now refuses it: this href is
    // asserted against `hrefShapes` at the write boundary, and the declared
    // shape is `/pro/viral-requests`.
    //
    // The list is not per-request (`/pro/viral-requests/{id}` does not exist),
    // so the href is the bare library path. A pro who taps arrives at every
    // look they were matched to, the new one included.
    href: PRO_VIRAL_REQUESTS_PATH,
    dedupeKey: buildViralRequestApprovedProNotificationDedupeKey(
      data.viralRequestId,
    ),
    data,
    tx: args.tx,
  })
}