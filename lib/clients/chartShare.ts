// lib/clients/chartShare.ts
//
// W5 — the write side of chart consent. The READ side is
// `lib/clientVisibility.ts`, which is the only thing that decides whether a pro
// may open a chart; this file is only how the row it reads gets there.
//
// One row per (client, pro), so "may this pro see this chart right now" always
// has exactly one answer. The transitions are deliberately asymmetric:
//
//   pro   → REQUESTED   (asking; grants nothing, one open ask at a time)
//   client→ GRANTED     (the only status that opens the chart)
//   client→ DECLINED    (an answer, not an absence)
//   client→ REVOKED     (taking back a grant)
//
// The client can always grant unprompted and can always revoke — a consent
// control that its own subject cannot reach is not consent.

import { ClientChartShareStatus } from '@prisma/client'

import { prisma } from '@/lib/prisma'

export type ChartShareState = {
  status: ClientChartShareStatus | null
  requestedAt: Date | null
  respondedAt: Date | null
  revokedAt: Date | null
}

export const NO_CHART_SHARE: ChartShareState = {
  status: null,
  requestedAt: null,
  respondedAt: null,
  revokedAt: null,
}

export async function loadChartShare(args: {
  clientId: string
  professionalId: string
}): Promise<ChartShareState> {
  const row = await prisma.clientChartShare.findUnique({
    where: {
      clientId_professionalId: {
        clientId: args.clientId,
        professionalId: args.professionalId,
      },
    },
    select: {
      status: true,
      requestedAt: true,
      respondedAt: true,
      revokedAt: true,
    },
  })

  return row ?? NO_CHART_SHARE
}

/**
 * How long after a client REVOKES before that pro may ask again.
 *
 * Revoking is the one refusal that stays re-askable (see `requestChartShare`),
 * which without a cooldown is a nag loop: the client turns access off, the pro
 * asks again the same minute, and the only way out is to decline permanently.
 * A month is long enough that re-asking reads as a fresh ask rather than
 * pushback on the decision the client just made.
 */
export const CHART_SHARE_REREQUEST_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000

export type ChartShareRequestBlockCode =
  | 'ALREADY_GRANTED'
  | 'REQUEST_PENDING'
  | 'DECLINED'
  | 'COOLDOWN'

export type ChartShareRequestBlock = {
  code: ChartShareRequestBlockCode
  /** Only on COOLDOWN: when the pro may ask again. */
  retryAt?: Date
}

/** The refusal arm spreads the block, so the codes are declared exactly once. */
export type ChartShareRequestResult =
  | { ok: true; status: ClientChartShareStatus }
  | ({ ok: false } & ChartShareRequestBlock)

/**
 * Why this pro may not ask right now — or null when they may.
 *
 * Pure, and exported, because TWO callers need this answer: the write path
 * below, and the pro's chart refusal screen, which decides whether to render a
 * "Request access" button or the reason there isn't one. Deriving that
 * separately in the UI is how a button appears for a state the server refuses
 * (or worse, disappears for one it allows).
 */
export function chartShareRequestBlock(
  existing: ChartShareState,
  now: Date,
): ChartShareRequestBlock | null {
  if (existing.status === ClientChartShareStatus.GRANTED) {
    return { code: 'ALREADY_GRANTED' }
  }
  if (existing.status === ClientChartShareStatus.REQUESTED) {
    return { code: 'REQUEST_PENDING' }
  }
  if (existing.status === ClientChartShareStatus.DECLINED) {
    return { code: 'DECLINED' }
  }
  // A REVOKED row always carries `revokedAt` (revokeChartShare stamps it), so
  // the null branch is unreachable in practice. It falls through to "allowed"
  // rather than "blocked" on purpose: with no timestamp there is no cooldown to
  // serve, and blocking forever would strand the pair with no way back.
  if (existing.status === ClientChartShareStatus.REVOKED && existing.revokedAt) {
    const retryAt = new Date(
      existing.revokedAt.getTime() + CHART_SHARE_REREQUEST_COOLDOWN_MS,
    )
    // `<` not `<=`: at exactly the cooldown boundary the wait is served.
    if (now < retryAt) return { code: 'COOLDOWN', retryAt }
  }

  return null
}

/**
 * The PRO asks. Rate-limited to one OPEN request per pair so it cannot be used
 * to nag: an existing REQUESTED row is refused rather than restamped, and a
 * DECLINED row is refused outright — a client's "no" must not be re-askable by
 * pressing the button again.
 *
 * A REVOKED row CAN be re-requested, but only after
 * `CHART_SHARE_REREQUEST_COOLDOWN_MS`. Revoking is "not right now"; declining is
 * "no". Collapsing the two would mean a client who revoked once could never be
 * asked again even if they wanted to re-share — but re-asking with no cooldown
 * turns "not right now" into a button the pro can press again immediately.
 */
export async function requestChartShare(args: {
  clientId: string
  professionalId: string
  now?: Date
}): Promise<ChartShareRequestResult> {
  const now = args.now ?? new Date()
  const existing = await loadChartShare(args)

  const blocked = chartShareRequestBlock(existing, now)
  if (blocked) return { ok: false, ...blocked }

  await upsertShare({
    clientId: args.clientId,
    professionalId: args.professionalId,
    status: ClientChartShareStatus.REQUESTED,
    data: { requestedAt: now, respondedAt: null, revokedAt: null },
  })

  return { ok: true, status: ClientChartShareStatus.REQUESTED }
}

/**
 * The CLIENT answers — or grants unprompted, which is why this does not require
 * an existing REQUESTED row.
 */
export async function respondToChartShare(args: {
  clientId: string
  professionalId: string
  grant: boolean
  now?: Date
}): Promise<{ status: ClientChartShareStatus }> {
  const now = args.now ?? new Date()
  const status = args.grant
    ? ClientChartShareStatus.GRANTED
    : ClientChartShareStatus.DECLINED

  await upsertShare({
    clientId: args.clientId,
    professionalId: args.professionalId,
    status,
    data: { respondedAt: now, revokedAt: null },
  })

  return { status }
}

/**
 * The CLIENT takes it back.
 *
 * ⚠️ Never gated on anything. A revoke that can be refused is not a revoke, and
 * the one thing worse than access nobody consented to is consent that cannot be
 * withdrawn. Revoking a pair with no row at all is a no-op that still reports
 * success — the end state the caller asked for is the end state they get.
 */
export async function revokeChartShare(args: {
  clientId: string
  professionalId: string
  now?: Date
}): Promise<{ status: ClientChartShareStatus }> {
  const now = args.now ?? new Date()

  await upsertShare({
    clientId: args.clientId,
    professionalId: args.professionalId,
    status: ClientChartShareStatus.REVOKED,
    data: { revokedAt: now },
  })

  return { status: ClientChartShareStatus.REVOKED }
}

type ChartShareTimestamps = {
  requestedAt?: Date | null
  respondedAt?: Date | null
  revokedAt?: Date | null
}

async function upsertShare(args: {
  clientId: string
  professionalId: string
  status: ClientChartShareStatus
  data: ChartShareTimestamps
}): Promise<void> {
  await prisma.clientChartShare.upsert({
    where: {
      clientId_professionalId: {
        clientId: args.clientId,
        professionalId: args.professionalId,
      },
    },
    create: {
      ...args.data,
      clientId: args.clientId,
      professionalId: args.professionalId,
      status: args.status,
    },
    update: {
      ...args.data,
      status: args.status,
    },
    select: { id: true },
  })
}
