import type {
  DeleteUserDataActionResult,
  DeleteUserDataResult,
} from './deleteUserData'

export type DeleteUserDataActionSummary = Pick<
  DeleteUserDataActionResult,
  'model' | 'action' | 'count'
>

export type DeleteUserDataSummary = {
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
  limitationsCount: number
}

/**
 * Route-safe summary for privacy deletion/anonymization results.
 *
 * The canonical deleteUserData result may contain operational notes and a
 * request reason. Internal operators need the mutation plan, but route
 * responses should avoid echoing free-text support/admin context.
 */
export function summarizeDeleteUserDataResult(
  result: DeleteUserDataResult,
): DeleteUserDataSummary {
  return {
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
    limitationsCount: result.limitations.length,
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
