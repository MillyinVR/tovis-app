// lib/proClientPolicy/load.ts
//
// K16 — the one read of `ProClientPolicy`, and the one place the card-on-file
// rail flag is applied to it.
//
// Takes a `db` so it can run INSIDE the write-boundary's locked transaction
// (`performLockedCreateHold`) rather than as a separate round-trip before it. A
// policy read outside the lock would be a check against state the transaction
// can no longer vouch for.
//
// Every call site goes through here, so no caller can accidentally read the raw
// row and skip `resolveProClientPolicy`'s rail gate.

import type { Prisma, PrismaClient } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import {
  resolveProClientPolicy,
  type ResolvedProClientPolicy,
} from '@/lib/proClientPolicy/policy'

type DbClient = Prisma.TransactionClient | PrismaClient

/** Exactly the columns the resolver reads — nothing else exists to read. */
export const PRO_CLIENT_POLICY_SELECT = {
  requireDeposit: true,
  prepayScope: true,
  requireCardOnFile: true,
  blockSelfServeBooking: true,
} satisfies Prisma.ProClientPolicySelect

/**
 * The resolved policy for one (pro, client) pair. Absent row → every default,
 * so callers never have to create one first.
 */
export async function loadProClientPolicy(args: {
  db?: DbClient
  professionalId: string
  clientId: string
}): Promise<ResolvedProClientPolicy> {
  const db = args.db ?? prisma

  const policy = await db.proClientPolicy.findUnique({
    where: {
      professionalId_clientId: {
        professionalId: args.professionalId,
        clientId: args.clientId,
      },
    },
    select: PRO_CLIENT_POLICY_SELECT,
  })

  return resolveProClientPolicy({
    policy,
    cardOnFileRailEnabled: noShowProtectionEnabled(),
  })
}
