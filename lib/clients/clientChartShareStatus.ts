// lib/clients/clientChartShareStatus.ts
//
// The CLIENT-facing reading of a `ClientChartShare.status` — the wording a
// client sees about one of their pros, and the single answer to "does this
// status actually open the chart?".
//
// Two surfaces need the same four sentences: the chart-sharing settings screen
// (`ClientChartSharingSettings`), which owns the controls, and the message
// thread header, which labels the pro the client is already talking to (iOS
// `ThreadView.clientChartAccessRow`, ported to web). They were one hand-rolled
// map in the settings component; a second copy in the thread would be the
// drifted-duplicate-copy failure this repo keeps paying for — the wording is a
// consent statement, and two versions of it is two different promises.
//
// 🔴 `GRANTED` is the ONLY status that opens the chart. `REQUESTED` grants
// nothing (the pro asked; the client has not answered), and `DECLINED` /
// `REVOKED` are both closed but are deliberately distinct states — see the enum
// docs in `prisma/schema.prisma`. Anything reading "is it shared" must go
// through {@link clientChartShareGrantsAccess} rather than compare strings, so
// a fifth status added later cannot silently default to "open".
import { ClientChartShareStatus } from '@prisma/client'

/**
 * What the CLIENT is told about this status. Phrased with the pro as the
 * implied subject, so it reads correctly both in a labelled settings row and
 * beside a pro's name in a thread header.
 */
export const CLIENT_CHART_SHARE_STATUS_COPY: Record<ClientChartShareStatus, string> =
  Object.freeze({
    [ClientChartShareStatus.GRANTED]: 'Can see your chart',
    [ClientChartShareStatus.REQUESTED]: 'Asked to see your chart',
    [ClientChartShareStatus.DECLINED]: 'You said no',
    [ClientChartShareStatus.REVOKED]: 'You turned this off',
  })

/** Narrow an untrusted wire value to a real status. */
export function isClientChartShareStatus(
  value: unknown,
): value is ClientChartShareStatus {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(CLIENT_CHART_SHARE_STATUS_COPY, value)
  )
}

/**
 * Is this status an OPEN ASK — the pro has requested and the client has not
 * answered?
 *
 * The one state that wants the client's attention. `GRANTED` is a fact, and
 * `DECLINED` / `REVOKED` are answers the client themselves already gave, so all
 * three are quiet; only an unanswered request is worth highlighting.
 */
export function clientChartShareIsOpenAsk(value: unknown): boolean {
  return value === ClientChartShareStatus.REQUESTED
}

/**
 * Does this status let the pro read the chart? `GRANTED` and nothing else.
 *
 * Fails CLOSED: an unrecognised value is not access.
 */
export function clientChartShareGrantsAccess(value: unknown): boolean {
  return value === ClientChartShareStatus.GRANTED
}
