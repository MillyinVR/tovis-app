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
    href: `/admin/viral-requests/${encodeURIComponent(data.viralRequestId)}`,
    dedupeKey: buildViralRequestApprovedProNotificationDedupeKey(
      data.viralRequestId,
    ),
    data,
    tx: args.tx,
  })
}