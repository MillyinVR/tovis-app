// lib/consult/analysisNotifications.ts
//
// P4b: telling the client her plan is ready — or that it isn't.
//
// This is the half of the background move that is easy to skip and impossible
// to do without. Making the analysis a job means the client is free to leave
// the screen; if leaving the screen means never finding out, the job is worse
// than the blocking request it replaced.
//
// Both events are TRANSACTIONAL and bypass quiet hours (see the definitions in
// lib/notifications/eventKeys.ts): the client explicitly asked for this and is
// waiting on it, which is a different thing entirely from the app deciding to
// nudge her.
//
// Copy discipline: neither notification carries any of the analysis. The
// result is behind a login and is a health-adjacent record — the notification
// is a doorbell, not a summary. The failure notification carries no error
// text either; `failureCode` is for the client app to map to its own copy.

import 'server-only'

import { ConsultAnalysisRunStatus, NotificationEventKey } from '@prisma/client'

import { upsertClientNotification } from '@/lib/notifications/clientNotifications'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export type ConsultAnalysisNotificationResult =
  | 'SENT_READY'
  | 'SENT_FAILED'
  | 'SKIPPED_NOT_TERMINAL'
  | 'SKIPPED_NOT_FOUND'
  | 'SKIPPED_ERROR'

/**
 * Emit the terminal notification for a run, exactly once.
 *
 * Idempotent through the dedupe key: it is keyed on the RUN, not the consult,
 * so a client who retried after a failure gets one "we couldn't finish" for
 * the run that failed and one "your plan is ready" for the run that worked —
 * rather than the second being swallowed as a duplicate of the first.
 *
 * Never throws. A notification that cannot be written must not roll back an
 * analysis that succeeded; the console line is what makes a persistent
 * failure visible instead of silent.
 */
export async function notifyConsultAnalysisRunSettled(args: {
  runId: string
}): Promise<ConsultAnalysisNotificationResult> {
  try {
    const run = await prisma.consultAnalysisRun.findUnique({
      where: { id: args.runId },
      select: {
        id: true,
        status: true,
        failureCode: true,
        consultSessionId: true,
        consultSession: { select: { clientId: true } },
      },
    })
    if (!run) return 'SKIPPED_NOT_FOUND'

    const href = `/client/consult/${encodeURIComponent(run.consultSessionId)}`

    if (run.status === ConsultAnalysisRunStatus.COMPLETED) {
      await upsertClientNotification({
        clientId: run.consultSession.clientId,
        eventKey: NotificationEventKey.AI_CONSULT_ANALYSIS_READY,
        title: 'Your consult is ready',
        body: 'Your directions are ready to look over before you talk to your professional.',
        href: `${href}/results`,
        dedupeKey: `AI_CONSULT_ANALYSIS_READY:${run.id}`,
        data: {
          consultSessionId: run.consultSessionId,
          analysisRunId: run.id,
          action: 'OPEN_AI_CONSULT_RESULTS',
        },
      })
      return 'SENT_READY'
    }

    if (run.status === ConsultAnalysisRunStatus.FAILED) {
      await upsertClientNotification({
        clientId: run.consultSession.clientId,
        eventKey: NotificationEventKey.AI_CONSULT_ANALYSIS_FAILED,
        title: 'We couldn’t finish your consult',
        body: 'Something went wrong while building your plan. You can try again — your photos and answers are still saved.',
        href,
        dedupeKey: `AI_CONSULT_ANALYSIS_FAILED:${run.id}`,
        data: {
          consultSessionId: run.consultSessionId,
          analysisRunId: run.id,
          // The code, not a message. The client app owns the wording.
          failureCode: run.failureCode,
          action: 'RETRY_AI_CONSULT_ANALYSIS',
        },
      })
      return 'SENT_FAILED'
    }

    return 'SKIPPED_NOT_TERMINAL'
  } catch (error: unknown) {
    console.error('consult analysis notification failed', {
      runId: args.runId,
      error: safeError(error),
    })
    return 'SKIPPED_ERROR'
  }
}
