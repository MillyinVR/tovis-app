// lib/privacy/deleteUserDataSummary.ts

import type {
  DeleteUserDataActionResult,
  DeleteUserDataResult,
} from './deleteUserData'

export type DeleteUserDataActionSummary = Pick<
  DeleteUserDataActionResult,
  'model' | 'action' | 'count'
>

export type DeleteUserDataSummary = {
  version: 1
  executedAt: string
  mode: DeleteUserDataResult['mode']
  subject: DeleteUserDataResult['subject']
  requestedByUserId: string
  actionCounts: {
    total: number
    wouldDelete: number
    wouldAnonymize: number
    deleted: number
    anonymized: number
    skipped: number
  }
  actions: DeleteUserDataActionSummary[]
  limitations: string[]
  limitationsCount: number
  requiresManualFollowUp: boolean
}

const DELETE_USER_DATA_SUMMARY_VERSION = 1 as const

/**
 * Route-safe summary for privacy deletion/anonymization results.
 *
 * The canonical deleteUserData result may contain request/admin free text.
 * Internal routes should expose the mutation plan plus sanitized limitation
 * text, without echoing the raw request reason.
 */
export function summarizeDeleteUserDataResult(
  result: DeleteUserDataResult,
): DeleteUserDataSummary {
  const limitations = result.limitations.map(sanitizeLimitation)

  return {
    version: DELETE_USER_DATA_SUMMARY_VERSION,
    executedAt: result.executedAt,
    mode: result.mode,
    subject: result.subject,
    requestedByUserId: result.requestedByUserId,
    actionCounts: summarizeActionCounts(result.actions),
    actions: result.actions.map(({ model, action, count }) => ({
      model,
      action,
      count,
    })),
    limitations,
    limitationsCount: limitations.length,
    requiresManualFollowUp: limitations.length > 0,
  }
}

function summarizeActionCounts(actions: DeleteUserDataActionResult[]): {
  total: number
  wouldDelete: number
  wouldAnonymize: number
  deleted: number
  anonymized: number
  skipped: number
} {
  return actions.reduce(
    (counts, action) => {
      counts.total += 1

      if (action.action === 'WOULD_DELETE') counts.wouldDelete += 1
      if (action.action === 'WOULD_ANONYMIZE') counts.wouldAnonymize += 1
      if (action.action === 'DELETED') counts.deleted += 1
      if (action.action === 'ANONYMIZED') counts.anonymized += 1
      if (action.action === 'SKIPPED') counts.skipped += 1

      return counts
    },
    {
      total: 0,
      wouldDelete: 0,
      wouldAnonymize: 0,
      deleted: 0,
      anonymized: 0,
      skipped: 0,
    },
  )
}

function sanitizeLimitation(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[redacted-email]')
    .replace(/\+?[1-9]\d{1,14}\b/gu, '[redacted-phone-or-id]')
    .replace(/https?:\/\/[^\s]+/giu, '[redacted-url]')
    .replace(/\b(?:token|secret|password|code)=\S+/giu, '[redacted-secret]')
    .trim()
}