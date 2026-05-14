// lib/aftercare/unclaimedAftercareAccess.ts

import { Prisma } from '@prisma/client'

import {
  markAftercareAccessTokenUsed,
  resolveAftercareAccessTokenForRead,
  type ResolvedAftercareAccessToken,
} from '@/lib/aftercare/aftercareAccessTokens'

export type ResolveAftercareAccessByTokenArgs = {
  rawToken: string
  tx?: Prisma.TransactionClient
}

export type ResolveAftercareAccessByTokenResult = Omit<
  ResolvedAftercareAccessToken,
  'idempotencyActorKey'
>

/**
 * Legacy compatibility resolver for public aftercare/rebook surfaces.
 *
 * New mutation routes should prefer:
 * - resolveAftercareAccessTokenForMutation()
 * - markAftercareAccessTokenUsed()
 *
 * This wrapper intentionally preserves the old behavior: resolving the token
 * also marks it used. Keep this only for non-idempotent legacy read surfaces
 * until those call sites are migrated.
 */
export async function resolveAftercareAccessByToken(
  args: ResolveAftercareAccessByTokenArgs,
): Promise<ResolveAftercareAccessByTokenResult> {
  const resolved = await resolveAftercareAccessTokenForRead({
    rawToken: args.rawToken,
    tx: args.tx,
  })

  const token = await markAftercareAccessTokenUsed({
    tokenId: resolved.token.id,
    tx: args.tx,
  })

  return {
    accessSource: resolved.accessSource,
    token,
    aftercare: resolved.aftercare,
    booking: resolved.booking,
  }
}