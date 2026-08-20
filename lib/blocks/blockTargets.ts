// lib/blocks/blockTargets.ts
//
// Resolving WHO a block is about, and listing who the viewer has blocked. The
// read-path filters live in lib/blocks/userBlocks.ts; this module is the
// identity half.
//
// A block is keyed on `User`, but no client ever learns a User id: the looks
// feed DTO carries a ProfessionalProfile id for a pro and a bare `@handle` for
// a client author, and `professionalId !== userId`. So a target is named the
// way the surface the viewer came from already names it, and resolved here.
//
// `HandleRegistration` is the one global handle namespace — its
// `handleNormalized` is the PRIMARY KEY and exactly one owner column is set —
// so a handle resolves to exactly one profile, and thus to exactly one person.

import type { Prisma, PrismaClient } from '@prisma/client'

import { normalizeHandle } from '@/lib/handles'
import {
  formatProfessionalPublicDisplayName,
  professionalPublicDisplayNameSelect,
} from '@/lib/privacy/professionalDisplayName'

/** A person the viewer can block. Server-internal: it carries the User id. */
export type BlockTarget = {
  userId: string
  handle: string
  /**
   * What to call them in the confirm prompt and the blocked list. For a pro
   * this honours their `nameDisplay` toggle; for a client it is the handle,
   * never a real name — the same PII line LooksClientAuthorDto draws.
   */
  displayName: string
  avatarUrl: string | null
}

/** One row of the viewer's blocked list. Wire-safe: no User id. */
export type BlockedAccount = {
  blockId: string
  handle: string
  displayName: string
  avatarUrl: string | null
}

/**
 * Every column the pro branch of {@link toProTarget} reads.
 *
 * Spreads the canonical `professionalPublicDisplayNameSelect` rather than
 * re-listing its columns: the display-name rule and the columns it needs are
 * one fact, and `firstName`/`lastName` are plaintext PII whose sanctioned
 * reader is that lib/privacy helper (check:pii-plaintext-reads enforces it).
 */
const proTargetSelect = {
  ...professionalPublicDisplayNameSelect,
  userId: true,
  avatarUrl: true,
} satisfies Prisma.ProfessionalProfileSelect

type ProTargetRow = Prisma.ProfessionalProfileGetPayload<{
  select: typeof proTargetSelect
}>

/**
 * One pro → one target. The single place the pro display-name rule is applied
 * for blocks, so the confirm prompt and the blocked list can never disagree.
 */
function toProTarget(pro: ProTargetRow, fallbackName: string): BlockTarget {
  return {
    userId: pro.userId,
    handle: pro.handle ?? '',
    displayName: formatProfessionalPublicDisplayName(pro, fallbackName),
    avatarUrl: pro.avatarUrl ?? null,
  }
}

/**
 * The person behind a public `@handle`, or null when no one holds it.
 *
 * 🔴 Reads the per-table `handleNormalized` columns, NOT `HandleRegistration`.
 * The registry is a uniqueness LOCK — its own schema comment says the per-table
 * columns "stay as the display/lookup source of truth; this table is purely the
 * lock" — and it is only written when a handle is claimed through
 * lib/handles/registry.ts. Handles that predate it have no row: on the dev
 * database 22 profiles hold a handle and only 16 registry rows exist, so
 * resolving through the registry 404'd a pro whose handle plainly works
 * everywhere else. Measured, not theorised.
 *
 * Pro is checked first. The lock makes a pro/client collision impossible for
 * any handle claimed since it landed; for an older pair the schema's own worked
 * example is a client squatting a well-known pro's handle, so resolving to the
 * pro is the safer precedence.
 *
 * Null when the handle belongs to a ClientProfile with no `userId` — a
 * pro-created client record no person has ever signed into. There is no account
 * there to block, and a block row pointing at nobody would be unliftable.
 */
export async function resolveBlockTargetByHandle(
  db: Pick<PrismaClient, 'professionalProfile' | 'clientProfile'>,
  rawHandle: string,
): Promise<BlockTarget | null> {
  const handleNormalized = normalizeHandle(rawHandle)
  if (!handleNormalized) return null

  const pro = await db.professionalProfile.findUnique({
    where: { handleNormalized },
    select: proTargetSelect,
  })
  if (pro) return toProTarget(pro, `@${handleNormalized}`)

  const client = await db.clientProfile.findUnique({
    where: { handleNormalized },
    select: { userId: true, handle: true, avatarUrl: true },
  })
  if (!client?.userId) return null

  return {
    userId: client.userId,
    handle: client.handle ?? handleNormalized,
    displayName: `@${client.handle ?? handleNormalized}`,
    avatarUrl: client.avatarUrl ?? null,
  }
}

/**
 * The person behind a ProfessionalProfile id. `/professionals/[id]` is the
 * canonical pro profile href (see lib/profiles/profileHrefs), so a pro is the
 * one target a viewer can reach without a handle in hand — a pro's handle is
 * nullable, and blocking must not depend on them having claimed one.
 */
export async function resolveBlockTargetByProfessionalId(
  db: Pick<PrismaClient, 'professionalProfile'>,
  professionalId: string,
): Promise<BlockTarget | null> {
  const pro = await db.professionalProfile.findUnique({
    where: { id: professionalId },
    select: proTargetSelect,
  })
  return pro ? toProTarget(pro, 'this professional') : null
}

/**
 * The accounts this viewer has blocked, newest first — the rows they may lift.
 *
 * Deliberately only the blocks the viewer MADE. Blocks RECEIVED also hide
 * content (the read filter is symmetric), but surfacing them would tell the
 * viewer who blocked them, which is exactly what a block exists to withhold.
 */
export async function loadBlockedAccounts(
  db: Pick<PrismaClient, 'userBlock'>,
  args: { userId: string },
): Promise<BlockedAccount[]> {
  const rows = await db.userBlock.findMany({
    where: { blockerUserId: args.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      blocked: {
        select: {
          professionalProfile: { select: proTargetSelect },
          clientProfile: { select: { handle: true, avatarUrl: true } },
        },
      },
    },
  })

  return rows.map((row) => {
    const pro = row.blocked.professionalProfile
    if (pro) {
      const target = toProTarget(pro, 'Blocked account')
      return {
        blockId: row.id,
        handle: target.handle,
        displayName: target.displayName,
        avatarUrl: target.avatarUrl,
      }
    }

    // A blocked account keeps its row even if it later clears its handle, so
    // the viewer can still lift a block they made — which is why the list is
    // keyed on the block's own id and not on the target's handle. The label
    // falls back rather than the row disappearing.
    const client = row.blocked.clientProfile
    return {
      blockId: row.id,
      handle: client?.handle ?? '',
      displayName: client?.handle ? `@${client.handle}` : 'Blocked account',
      avatarUrl: client?.avatarUrl ?? null,
    }
  })
}

/**
 * The viewer's own block on one person, or null — the id the Unblock control
 * needs to lift it.
 *
 * 🔴 Kept OUT of the profile DTOs on purpose. `PublicClientProfileViewer` is
 * re-exported from lib/dto/index.ts, so it is part of the iOS wire contract
 * (`check:ios-fixture-contract` validates this branch against tovis-ios
 * `origin/main`); adding a required field there would redden this repo's CI
 * until a matching iOS PR merged. The profile pages call this directly instead,
 * so the block ships on web without a forced cross-repo merge order.
 *
 * Only a block the viewer MADE — a block RECEIVED must never be surfaced.
 */
export async function loadViewerBlockId(
  db: Pick<PrismaClient, 'userBlock'>,
  args: { viewerUserId: string; blockedUserId: string },
): Promise<string | null> {
  if (args.viewerUserId === args.blockedUserId) return null

  const row = await db.userBlock.findUnique({
    where: {
      blockerUserId_blockedUserId: {
        blockerUserId: args.viewerUserId,
        blockedUserId: args.blockedUserId,
      },
    },
    select: { id: true },
  })
  return row?.id ?? null
}
