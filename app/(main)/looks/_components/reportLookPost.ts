// app/(main)/looks/_components/reportLookPost.ts
'use client'

/**
 * Client half of `POST /api/v1/looks/{id}/report` — the UGC report path for a
 * look POST (the photo), as opposed to the comment path that
 * `useLookComments.report` already drives.
 *
 * ⚠️ **The route reads no body.** Its handler parameter is literally `_req` and
 * is never read, so a `reason` sent here would be silently discarded and stored
 * as `OTHER`. A `ModerationReportReason` enum exists in the schema but NO route
 * surfaces it — so do NOT add a reason picker on top of this until the route
 * accepts one, or the UI promises the reviewer a choice that never reaches the
 * server. `{}`-less POST matches the sibling toggles (hide/like).
 *
 * Idempotent by the `LookPostReport` unique constraint: a repeat is not an
 * error but a 200 `already_reported` (a first report is 201 `accepted`). Both
 * are `res.ok`, so both settle as `'ok'` — the caller shows "Reported" either
 * way. There is no un-report route.
 *
 * There is **no server-side rate limit and no idempotency wrapper**, so the
 * caller owns debouncing (the rail disables the control once it leaves idle).
 *
 * The server does not reject reporting your OWN look, mirroring the comment
 * route; the gate is client-side only where ownership is known.
 */
export type LookReportResult = 'ok' | 'auth' | 'error'

export async function reportLookPost(
  lookPostId: string,
): Promise<LookReportResult> {
  if (!lookPostId) return 'error'

  try {
    const res = await fetch(`/api/v1/looks/${lookPostId}/report`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })

    // 401 is the guest signal every other looks mutation uses; the caller
    // decides where to send them.
    if (res.status === 401) return 'auth'

    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}
