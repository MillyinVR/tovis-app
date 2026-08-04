// app/api/internal/jobs/account-deletion/route.ts
//
// Cron: 0 * * * * (hourly)
// Executes account deletion requests whose grace window has closed.
//
// The window is the whole point of the split: the request handler records
// intent, this job carries it out, and everything in between is the user's
// chance to cancel. Nothing here is reachable without the internal job secret.

import { jsonFail, jsonOk } from '@/app/api/_utils'
import {
  getInternalJobSecret,
  isAuthorizedJobRequest,
} from '@/app/api/_utils/auth/internalJob'
import { executeDueAccountDeletions } from '@/lib/privacy/accountDeletion'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function runJob(req: Request) {
  const secret = getInternalJobSecret()
  if (!secret) {
    return jsonFail(
      500,
      'Missing INTERNAL_JOB_SECRET or CRON_SECRET configuration.',
    )
  }

  if (!isAuthorizedJobRequest(req)) {
    return jsonFail(401, 'Unauthorized')
  }

  const now = new Date()

  try {
    const result = await executeDueAccountDeletions({ db: prisma, now })

    return jsonOk({
      considered: result.considered,
      completed: result.completed,
      failed: result.failed,
      ranAt: now.toISOString(),
    })
  } catch (error: unknown) {
    console.error('account-deletion sweep error', { error: safeError(error) })
    return jsonFail(500, 'Account deletion sweep failed.')
  }
}

export async function GET(req: Request) {
  return runJob(req)
}

export async function POST(req: Request) {
  return runJob(req)
}
