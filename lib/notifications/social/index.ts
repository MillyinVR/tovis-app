import { Prisma } from '@prisma/client'

import { createViralRequestApprovedProNotification } from '@/lib/notifications/viralRequestApproved'

export type ApprovedViralRequestMatchRecipient = {
  professionalId: string
  matchedServiceIds: readonly string[]
}

export type NotifyMatchedProsAboutApprovedViralRequestArgs = {
  viralRequestId: string
  requestName: string
  requestedCategoryId?: string | null
  recipients: readonly ApprovedViralRequestMatchRecipient[]
  tx?: Prisma.TransactionClient
}

export type NotifyMatchedProsAboutApprovedViralRequestResult = {
  matchedProfessionalIds: string[]
  notificationIds: string[]
}

function normalizeRequiredId(name: string, value: string): string {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error(`${name} is required.`)
  }

  return trimmed
}

function normalizeOptionalId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function mergeRecipientServiceIds(
  current: readonly string[],
  next: readonly string[],
): string[] {
  const merged = new Set<string>(current)

  for (const value of next) {
    const normalized = normalizeOptionalId(value)
    if (normalized) {
      merged.add(normalized)
    }
  }

  return Array.from(merged)
}

function dedupeRecipients(
  recipients: readonly ApprovedViralRequestMatchRecipient[],
): ApprovedViralRequestMatchRecipient[] {
  const byProfessionalId = new Map<string, string[]>()

  for (const recipient of recipients) {
    const professionalId = normalizeRequiredId(
      'professionalId',
      recipient.professionalId,
    )

    const current = byProfessionalId.get(professionalId) ?? []
    byProfessionalId.set(
      professionalId,
      mergeRecipientServiceIds(current, recipient.matchedServiceIds),
    )
  }

  return Array.from(byProfessionalId.entries()).map(
    ([professionalId, matchedServiceIds]) => ({
      professionalId,
      matchedServiceIds,
    }),
  )
}

export async function notifyMatchedProsAboutApprovedViralRequest(
  args: NotifyMatchedProsAboutApprovedViralRequestArgs,
): Promise<NotifyMatchedProsAboutApprovedViralRequestResult> {
  const viralRequestId = normalizeRequiredId(
    'viralRequestId',
    args.viralRequestId,
  )
  const requestName = normalizeRequiredId('requestName', args.requestName)
  const requestedCategoryId = normalizeOptionalId(args.requestedCategoryId)
  const recipients = dedupeRecipients(args.recipients)

  const matchedProfessionalIds: string[] = []
  const notificationIds: string[] = []

  for (const recipient of recipients) {
    const result = await createViralRequestApprovedProNotification({
      professionalId: recipient.professionalId,
      viralRequestId,
      requestName,
      requestedCategoryId,
      matchedServiceIds: recipient.matchedServiceIds,
      tx: args.tx,
    })

    matchedProfessionalIds.push(recipient.professionalId)
    notificationIds.push(result.id)
  }

  return {
    matchedProfessionalIds,
    notificationIds,
  }
}