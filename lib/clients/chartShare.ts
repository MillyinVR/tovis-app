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

export type ChartShareRequestResult =
  | { ok: true; status: ClientChartShareStatus }
  | { ok: false; code: 'ALREADY_GRANTED' | 'REQUEST_PENDING' | 'DECLINED' }

/**
 * The PRO asks. Rate-limited to one OPEN request per pair so it cannot be used
 * to nag: an existing REQUESTED row is refused rather than restamped, and a
 * DECLINED row is refused outright — a client's "no" must not be re-askable by
 * pressing the button again.
 *
 * A REVOKED row CAN be re-requested. Revoking is "not right now"; declining is
 * "no". Collapsing the two would mean a client who revoked once could never be
 * asked again even if they wanted to re-share.
 */
export async function requestChartShare(args: {
  clientId: string
  professionalId: string
  now?: Date
}): Promise<ChartShareRequestResult> {
  const now = args.now ?? new Date()
  const existing = await loadChartShare(args)

  if (existing.status === ClientChartShareStatus.GRANTED) {
    return { ok: false, code: 'ALREADY_GRANTED' }
  }
  if (existing.status === ClientChartShareStatus.REQUESTED) {
    return { ok: false, code: 'REQUEST_PENDING' }
  }
  if (existing.status === ClientChartShareStatus.DECLINED) {
    return { ok: false, code: 'DECLINED' }
  }

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
