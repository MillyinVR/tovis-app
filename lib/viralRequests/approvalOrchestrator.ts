import { Prisma, PrismaClient } from '@prisma/client'

import {
  createViralRequestApprovalFanOutRows,
  enqueueViralRequestApprovalNotifications,
  markViralRequestApprovalFanOutRowsFailed,
  markViralRequestApprovalFanOutRowsQueued,
} from '@/lib/viralRequests'

export type ViralApprovalOrchestratorDb =
  | PrismaClient
  | Prisma.TransactionClient

export type RunViralRequestApprovalOrchestrationArgs = {
  requestId: string
}

export type RunViralRequestApprovalOrchestrationResult = {
  requestId: string
  matchedProfessionalIds: string[]
  fanOutRowIds: string[]
  notificationIds: string[]
  smsDeferred: true
  fanOutRowsCreated: boolean
  blocked: {
    durableFanOutRows: false
    smsForEvent: true
  }
}

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

function normalizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Unknown viral approval orchestration error.'
  }

  const message = error.message.trim()

  return message.length > 0
    ? message
    : 'Unknown viral approval orchestration error.'
}

export async function runViralRequestApprovalOrchestration(
  db: ViralApprovalOrchestratorDb,
  args: RunViralRequestApprovalOrchestrationArgs,
): Promise<RunViralRequestApprovalOrchestrationResult> {
  const requestId = normalizeRequiredId('requestId', args.requestId)

  const fanOut = await createViralRequestApprovalFanOutRows(db, {
    requestId,
  })

  const fanOutRowIds = fanOut.fanOutRows.map((row) => row.id)

  if (fanOutRowIds.length === 0) {
    return {
      requestId: fanOut.requestId,
      matchedProfessionalIds: fanOut.matchedProfessionalIds,
      fanOutRowIds: [],
      notificationIds: [],
      smsDeferred: true,
      fanOutRowsCreated: false,
      blocked: {
        durableFanOutRows: false,
        smsForEvent: true,
      },
    }
  }

  try {
    const notifications = await enqueueViralRequestApprovalNotifications(db, {
      requestId: fanOut.requestId,
    })

    await markViralRequestApprovalFanOutRowsQueued(db, {
      fanOutRowIds,
    })

    return {
      requestId: fanOut.requestId,
      matchedProfessionalIds: fanOut.matchedProfessionalIds,
      fanOutRowIds,
      notificationIds: notifications.notificationIds,
      smsDeferred: true,
      fanOutRowsCreated: true,
      blocked: {
        durableFanOutRows: false,
        smsForEvent: true,
      },
    }
  } catch (error) {
    const message = normalizeErrorMessage(error)

    try {
      await markViralRequestApprovalFanOutRowsFailed(db, {
        fanOutRowIds,
        message,
      })
    } catch {
      // Preserve the original orchestration failure.
    }

    throw error
  }
}