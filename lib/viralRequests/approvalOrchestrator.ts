import { Prisma, PrismaClient, ViralServiceRequestStatus } from '@prisma/client'

import {
  enqueueViralRequestApprovalNotifications,
  findMatchingProsForViralRequest,
  getViralRequestByIdOrThrow,
} from '@/lib/viralRequests'

export type ViralApprovalOrchestratorDb = PrismaClient | Prisma.TransactionClient

export type RunViralRequestApprovalOrchestrationArgs = {
  requestId: string
}

export type RunViralRequestApprovalOrchestrationResult = {
  requestId: string
  matchedProfessionalIds: string[]
  notificationIds: string[]
  smsDeferred: true
  fanOutRowsCreated: false
  blocked: {
    durableFanOutRows: true
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

export async function runViralRequestApprovalOrchestration(
  db: ViralApprovalOrchestratorDb,
  args: RunViralRequestApprovalOrchestrationArgs,
): Promise<RunViralRequestApprovalOrchestrationResult> {
  const requestId = normalizeRequiredId('requestId', args.requestId)
  const request = await getViralRequestByIdOrThrow(db, requestId)

  if (request.status !== ViralServiceRequestStatus.APPROVED) {
    throw new Error(
      'Viral request must be APPROVED before approval orchestration can run.',
    )
  }

  const matches = await findMatchingProsForViralRequest(db, {
    requestId: request.id,
  })

  const notifications = await enqueueViralRequestApprovalNotifications(db, {
    requestId: request.id,
  })

  return {
    requestId: request.id,
    matchedProfessionalIds:
      matches.map((match) => match.id),
    notificationIds: notifications.notificationIds,
    smsDeferred: true,
    fanOutRowsCreated: false,
    blocked: {
      durableFanOutRows: true,
      smsForEvent: true,
    },
  }
}