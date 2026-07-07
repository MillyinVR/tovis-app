// lib/personalization/selfProfileStore.ts
//
// Persistence for the user-level self-profile (spec §6.6). All reads and
// writes round-trip through normalizeSelfProfile so nothing invalid is ever
// stored or served — lib/personalization/selfProfile.ts stays the SSOT.

import { Prisma, type PrismaClient } from '@prisma/client'
import {
  applySelfProfilePatch,
  extractSelfProfileWriteThrough,
  normalizeSelfProfile,
  type ClientSelfProfile,
  type SelfProfilePatch,
} from '@/lib/personalization/selfProfile'
import type { BoardAnswers } from '@/lib/boards/context'

type SelfProfileDb = Prisma.TransactionClient | PrismaClient

export type ClientSelfProfileRecord = {
  selfProfile: ClientSelfProfile | null
  selfProfileUpdatedAt: Date | null
}

export async function readClientSelfProfile(
  db: SelfProfileDb,
  clientId: string,
): Promise<ClientSelfProfileRecord | null> {
  const row = await db.clientProfile.findUnique({
    where: { id: clientId },
    select: { selfProfile: true, selfProfileUpdatedAt: true },
  })
  if (!row) return null

  return {
    selfProfile: normalizeSelfProfile(row.selfProfile),
    selfProfileUpdatedAt: row.selfProfileUpdatedAt,
  }
}

/**
 * Apply a validated patch to a client's self-profile, stamping
 * selfProfileUpdatedAt. Returns the resulting record. A patch that changes
 * nothing still stamps — the client actively confirmed the values.
 */
export async function writeClientSelfProfilePatch(
  db: SelfProfileDb,
  args: {
    clientId: string
    patch: SelfProfilePatch
    now: Date
  },
): Promise<ClientSelfProfileRecord | null> {
  const current = await readClientSelfProfile(db, args.clientId)
  if (!current) return null

  const next = applySelfProfilePatch(current.selfProfile, args.patch)

  const updated = await db.clientProfile.update({
    where: { id: args.clientId },
    data: {
      // Prisma Json null semantics: DbNull clears the column.
      selfProfile: next ?? Prisma.DbNull,
      selfProfileUpdatedAt: args.now,
    },
    select: { selfProfile: true, selfProfileUpdatedAt: true },
  })

  return {
    selfProfile: normalizeSelfProfile(updated.selfProfile),
    selfProfileUpdatedAt: updated.selfProfileUpdatedAt,
  }
}

/**
 * Board-answer write-through (spec §7.3): save the person-describing subset of
 * a board's answers to the self-profile. Sets only — never clears. No-ops
 * (without stamping) when the answers carry nothing person-describing.
 * Callers invoke this ONLY on the client's explicit opt-in — never silently.
 */
export async function applyBoardAnswersWriteThrough(
  db: SelfProfileDb,
  args: {
    clientId: string
    answers: BoardAnswers | null | undefined
    now: Date
  },
): Promise<ClientSelfProfileRecord | null> {
  const patch = extractSelfProfileWriteThrough(args.answers)
  if (!patch) return readClientSelfProfile(db, args.clientId)

  return writeClientSelfProfilePatch(db, {
    clientId: args.clientId,
    patch,
    now: args.now,
  })
}
