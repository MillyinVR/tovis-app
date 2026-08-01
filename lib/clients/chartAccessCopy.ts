// lib/clients/chartAccessCopy.ts
//
// W5 follow-up: what a pro is TOLD when the chart gate refuses them.
//
// The refusal itself is correct — a bare message thread no longer opens a
// client's chart. But every chart route answered with a flat "Forbidden." /
// "Client not found.", and the iOS client passes the server's copy straight
// through to the pro (`ProClientChartView.swift` — "The server's copy is already
// pro-facing… so pass it straight through"). So the pro who is MOST likely to
// hit this — one who is actively messaging a client — would read "Forbidden."
// about someone they are mid-conversation with, with no hint that asking is an
// option and no idea why it changed.
//
// The two refusals are genuinely different states and must not read the same:
//
//   CONTACT_ONLY  the pro knows this client and can ask → say so.
//   NONE          no relationship at all → the old, deliberately flat answer.
//                 Never confirm to a stranger that a given client id exists.

import type { ClientVisibilityResult } from '@/lib/clientVisibility'

export type ChartRefusal = {
  status: 404 | 403
  message: string
  code: 'CHART_NOT_SHARED' | 'NO_CLIENT_RELATIONSHIP'
}

/**
 * Turn a failed `assertProCanViewClient` into an honest refusal.
 *
 * @param notFoundStatus Some chart routes answer 404 (the chart aggregate hides
 *   existence) and others 403. Pass whichever that route already used so this
 *   changes the COPY without changing any route's status contract.
 */
export function chartRefusal(
  visibility: ClientVisibilityResult | null | undefined,
  notFoundStatus: 404 | 403 = 403,
): ChartRefusal {
  // Fail CLOSED on an unexpected shape. This runs on a refusal path, so a throw
  // here would turn a clean 403 into a 500 — the one response that tells a
  // caller nothing and pages someone. An absent visibility degrades to the
  // tightest copy, which is also the privacy-safe one.
  if (visibility?.canContactClient === true) {
    return {
      status: notFoundStatus,
      message:
        'This client hasn’t shared their chart with you yet. You can ask them for access, or it opens automatically once they book.',
      code: 'CHART_NOT_SHARED',
    }
  }

  return {
    status: notFoundStatus,
    message: 'Client not found.',
    code: 'NO_CLIENT_RELATIONSHIP',
  }
}
