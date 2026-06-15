// lib/admin/auditLog.ts

import { Prisma } from '@prisma/client'

import { asTrimmedString } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { redactAuditPayload } from '@/lib/security/auditRedaction'

type DbClient = Prisma.TransactionClient | typeof prisma

type AdminAuditJsonInput = Prisma.JsonValue | null | undefined

type AdminAuditTargetType = 'service' | 'category' | 'professional' | 'other'

export type WriteAdminAuditLogArgs = {
  adminUserId: string
  action: string

  /**
   * Use these typed target ids when known. They map directly to the current
   * AdminActionLog schema.
   */
  serviceId?: string | null
  categoryId?: string | null
  professionalId?: string | null

  /**
   * Optional generic target context. Since the current AdminActionLog schema has
   * no targetId/targetType columns, these are stored inside the redacted note.
   */
  targetType?: AdminAuditTargetType | string | null
  targetId?: string | null

  oldValue?: AdminAuditJsonInput
  newValue?: AdminAuditJsonInput
  metadata?: AdminAuditJsonInput
  note?: string | null

  tx?: Prisma.TransactionClient
}

export type WriteAdminAuditLogResult = {
  id: string
  adminUserId: string
  action: string
  note: string | null
  serviceId: string | null
  categoryId: string | null
  professionalId: string | null
  createdAt: Date
}

const ADMIN_ACTION_LOG_SELECT = {
  id: true,
  adminUserId: true,
  action: true,
  note: true,
  serviceId: true,
  categoryId: true,
  professionalId: true,
  createdAt: true,
} satisfies Prisma.AdminActionLogSelect

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`admin/auditLog: ${fieldName} is required.`)
  }

  return trimmed
}

function maybeRedactPayload(value: AdminAuditJsonInput): Prisma.JsonValue | null {
  if (value === undefined || value === null) return null
  return redactAuditPayload(value)
}

function buildAuditNote(args: {
  note: string | null
  targetType: string | null
  targetId: string | null
  oldValue: AdminAuditJsonInput
  newValue: AdminAuditJsonInput
  metadata: AdminAuditJsonInput
}): string | null {
  const redactedNote = args.note ? '[REDACTED]' : null

  const payload: Prisma.JsonObject = {}

  if (redactedNote) {
    payload.note = redactedNote
  }

  if (args.targetType) {
    payload.targetType = args.targetType
  }

  if (args.targetId) {
    payload.targetId = args.targetId
  }

  const oldValue = maybeRedactPayload(args.oldValue)
  if (oldValue !== null) {
    payload.oldValue = oldValue
  }

  const newValue = maybeRedactPayload(args.newValue)
  if (newValue !== null) {
    payload.newValue = newValue
  }

  const metadata = maybeRedactPayload(args.metadata)
  if (metadata !== null) {
    payload.metadata = metadata
  }

  if (Object.keys(payload).length === 0) {
    return null
  }

  return JSON.stringify(payload)
}

export async function writeAdminAuditLog(
  args: WriteAdminAuditLogArgs,
): Promise<WriteAdminAuditLogResult> {
  const db = getDb(args.tx)

  const adminUserId = normalizeRequiredString(args.adminUserId, 'adminUserId')
  const action = normalizeRequiredString(args.action, 'action')

  const serviceId = asTrimmedString(args.serviceId)
  const categoryId = asTrimmedString(args.categoryId)
  const professionalId = asTrimmedString(args.professionalId)
  const targetType = asTrimmedString(args.targetType)
  const targetId = asTrimmedString(args.targetId)
  const note = asTrimmedString(args.note)

  return db.adminActionLog.create({
    data: {
      adminUserId,
      action,
      serviceId,
      categoryId,
      professionalId,
      note: buildAuditNote({
        note,
        targetType,
        targetId,
        oldValue: args.oldValue,
        newValue: args.newValue,
        metadata: args.metadata,
      }),
    },
    select: ADMIN_ACTION_LOG_SELECT,
  })
}